/// <reference types="@cloudflare/workers-types" />

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

interface LimitConfig {
  name: string;
  requests: number;
  windowMs: number;
  limiter: string; // This will be the actual IP, user ID, or "global"
}

interface RateLimitResult {
  allowed: boolean;
  error?: string;
}

function formatResetTime(resetTime: number): string {
  const seconds = Math.ceil((resetTime - Date.now()) / 1000);
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.ceil(minutes / 60);

  if (seconds < 60) return `${seconds} seconds`;
  if (minutes < 60) return `${minutes} minutes`;
  return `${hours} hours`;
}

async function checkLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowMs: number,
  limitName: string
): Promise<RateLimitResult> {
  const now = Date.now();

  try {
    const stored = (await kv.get(key, "json")) as RateLimitInfo | null;

    if (!stored || now > stored.resetTime) {
      // Reset or first request
      const resetTime = now + windowMs;
      await kv.put(key, JSON.stringify({ count: 1, resetTime }), {
        expirationTtl: Math.max(Math.ceil(windowMs / 1000), 60),
      });
      return { allowed: true };
    }

    if (stored.count >= limit) {
      const timeLeft = formatResetTime(stored.resetTime);
      return {
        allowed: false,
        error: `${limitName} rate limit exceeded. Try again in ${timeLeft}.`,
      };
    }

    // Increment count
    await kv.put(
      key,
      JSON.stringify({
        count: stored.count + 1,
        resetTime: stored.resetTime,
      }),
      {
        expirationTtl: Math.max(Math.ceil((stored.resetTime - now) / 1000), 60),
      }
    );

    return { allowed: true };
  } catch (error) {
    console.error(`Rate limit check failed for ${key}:`, error);
    return { allowed: true }; // Fail open
  }
}

export async function rateLimitMiddleware(
  kv: KVNamespace,
  config: { limits: LimitConfig[] }
): Promise<Response | null> {
  // Check all limits in parallel
  const limitChecks = config.limits.map((limitConfig) => {
    const key = `${limitConfig.name}:${limitConfig.limiter}`;
    return checkLimit(
      kv,
      key,
      limitConfig.requests,
      limitConfig.windowMs,
      limitConfig.name
    );
  });

  const results = await Promise.all(limitChecks);

  // Find first failed limit
  for (const result of results) {
    if (!result.allowed) {
      return new Response(result.error, { status: 429 });
    }
  }

  return null; // No rate limit hit, continue
}
