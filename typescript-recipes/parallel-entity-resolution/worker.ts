/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { Parallel } from "parallel-web";
export interface Env {}

interface ResolutionRequest {
  input: string;
}

interface ProfileResult {
  platform_slug: string;
  profile_url: string;
  is_self_proclaimed: boolean;
  is_self_referring: boolean;
  match_reasoning: string;
  profile_snippet: string;
}

interface ResolutionResult {
  profiles: ProfileResult[];
}

interface TaskResult {
  run: { status: string };
  output: { content: ResolutionResult };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    // Handle OAuth callback
    if (url.pathname === "/callback") {
      return handleOAuthCallback(request, url);
    }

    // Handle resolution endpoints
    if (url.pathname === "/resolve" && request.method === "POST") {
      return handleResolutionSubmission(request);
    }

    if (url.pathname.startsWith("/resolve/") && request.method === "GET") {
      const trunId = url.pathname.split("/resolve/")[1];
      return handleResolutionResult(request, trunId);
    }

    // Handle logout
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout();
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function handleCORS(): Response {
  return new Response(null, {
    status: 200,
    headers: getCORSHeaders(),
  });
}

function getCORSHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}

async function handleOAuthCallback(
  request: Request,
  url: URL,
): Promise<Response> {
  const code = url.searchParams.get("code");
  const isLocalhost = new URL(request.url).hostname === "localhost";
  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  try {
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const codeVerifier = cookies.code_verifier;

    if (!codeVerifier) {
      return new Response("Missing code verifier", { status: 400 });
    }

    const tokenResponse = await fetch(
      "https://platform.parallel.ai/getKeys/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          client_id: url.hostname,
          redirect_uri: `${url.origin}/callback`,
          code_verifier: codeVerifier,
        }),
      },
    );

    const tokenData = await tokenResponse.json<{
      access_token?: string;
      error?: string;
    }>();

    if (tokenData.access_token) {
      const headers = new Headers({ Location: "/?auth=success" });
      const securePart = isLocalhost ? `` : ` Secure;`;

      // WARNING: This cookie is made directly accessible to front-end JavaScript (no HttpOnly flag).
      // The API key is intentionally exposed to the frontend for client-side API calls for the purposes of this demo.
      // Ensure this is only used in trusted contexts and consider the security implications.
      headers.append(
        "Set-Cookie",
        `parallel_api_key=${tokenData.access_token}; Path=/; ${securePart} SameSite=Lax; Max-Age=2592000`,
      );
      headers.append(
        "Set-Cookie",
        "code_verifier=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      );
      const response = new Response("", { status: 302, headers });
      return response;
    } else {
      return new Response("Failed to exchange token", { status: 400 });
    }
  } catch (error) {
    return new Response("OAuth error", { status: 500 });
  }
}

async function handleResolutionSubmission(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ResolutionRequest;
    const apiKey = getApiKey(request);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key required" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      });
    }

    const input = `You are a person entity resolution system. Given information about a person, find and return their digital profiles across various platforms.

Input: 
"""
${body.input}
"""

Instructions:

1. Analyze the input for any directly mentioned social media handles, usernames, email addresses, names, or other identifying information.
2. Search for and identify profiles across platforms like Twitter, LinkedIn, GitHub, Instagram, Facebook, TikTok, etc.
3. For each profile found, determine is_self_proclaimed, is_self_referring, match_reasoning, and profile_snippet
4. If no profiles can be found, return an empty profiles array

Be thorough but conservative - only return profiles you're confident about belong to the same person.
`;
    const client = new Parallel({ apiKey });

    const output_json_schema = {
      type: "object",
      required: ["profiles"],
      properties: {
        profiles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform_slug: {
                type: "string",
                description:
                  "Platform identifier (e.g., 'twitter', 'linkedin', 'github')",
              },
              profile_url: {
                type: "string",
                description: "Full URL to the profile",
              },
              is_self_proclaimed: {
                type: "boolean",
                description:
                  "Whether this profile was discovered through the input's chain of references. " +
                  "true if: (1) directly mentioned in the original input, " +
                  "(2) linked from a profile mentioned in the input, or " +
                  "(3) linked from any profile in this chain (transitive relationship). " +
                  "false if discovered only through external search without a self-reference chain.",
              },
              is_self_referring: {
                type: "boolean",
                description:
                  "Whether this profile links back to input profile(s) or other found profile(s)",
              },
              match_reasoning: {
                type: "string",
                description:
                  "Explanation of why this profile matches the input person",
              },
              profile_snippet: {
                type: "string",
                description: "Brief excerpt or description from the profile",
              },
            },
            required: [
              "platform_slug",
              "profile_url",
              "is_self_proclaimed",
              "is_self_referring",
              "match_reasoning",
              "profile_snippet",
            ],
          },
        },
      },
    };

    const result = await client.taskRun.create({
      input,
      processor: "pro",
      task_spec: {
        output_schema: { json_schema: output_json_schema, type: "json" },
      },
    });

    if (result.run_id) {
      return new Response(JSON.stringify({ trun_id: result.run_id }), {
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      });
    } else {
      return new Response(
        JSON.stringify({ error: "Failed to create resolution task" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...getCORSHeaders(),
          },
        },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to submit resolution" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      },
    );
  }
}

async function handleResolutionResult(
  request: Request,
  trunId: string,
): Promise<Response> {
  try {
    const apiKey = getApiKey(request);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key required" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      });
    }

    const response = await fetch(
      `https://api.parallel.ai/v1/tasks/runs/${trunId}/result`,
      { headers: { "x-api-key": apiKey } },
    );

    const result = await response.json<TaskResult>();

    if (result.run && result.run.status === "completed" && result.output) {
      // Extract the profiles from the output content
      const profiles = result.output.content?.profiles || [];

      return new Response(JSON.stringify({ profiles }), {
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      });
    } else if (result.run) {
      // Task is still running or failed
      return new Response(JSON.stringify({ status: result.run.status }), {
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      });
    } else {
      return new Response(
        JSON.stringify({ error: "Task not found or failed" }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...getCORSHeaders(),
          },
        },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to get resolution result" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      },
    );
  }
}

async function handleLogout() {
  return new Response("", {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie":
        "parallel_api_key=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    },
  });
}

function getApiKey(request: Request): string | null {
  // Try header first
  const headerKey = request.headers.get("x-api-key");
  if (headerKey) return headerKey;

  // Try cookie
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  return cookies.parallel_api_key || null;
}

function parseCookies(cookieString: string): Record<string, string> {
  return cookieString.split(";").reduce(
    (cookies, cookie) => {
      const [name, value] = cookie.trim().split("=");
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
      return cookies;
    },
    {} as Record<string, string>,
  );
}
