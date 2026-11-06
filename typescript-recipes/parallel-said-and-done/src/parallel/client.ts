/**
 * The Parallel SDK client. Entrypoints (scripts, webhook routes) call
 * `parallelClient()` once and pass the client down; nothing else reads the key.
 *
 * Every API this app uses goes through it:
 *   client.taskRun / client.taskGroup   Task API          (src/parallel/task.ts)
 *   client.extract                      Extract API       (src/sheet/fill.ts, src/updates/callday.ts)
 *   client.search                       Search API        (same)
 *   POST /v1/images/search              Image Search API  (below; no SDK resource yet)
 *   client.monitor                      Monitor API       (src/updates/monitors.ts)
 */
import Parallel from "parallel-web";

export type { Parallel };

export function parallelClient(env: NodeJS.ProcessEnv = process.env): Parallel {
  const apiKey = env.PARALLEL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("PARALLEL_API_KEY is not set. Get a key at https://platform.parallel.ai");
  }
  return new Parallel({
    apiKey,
    baseURL: env.PARALLEL_API_BASE_URL || undefined,
    timeout: Number(env.PARALLEL_REQUEST_TIMEOUT_MS ?? 120_000),
    // The SDK retries connection errors, 408, 409, 429 and 5xx with backoff.
    maxRetries: 3,
  });
}

/** An error message that is safe to log: never contains the API key. */
export function publicError(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const message = error instanceof Error ? error.message : String(error);
  const key = env.PARALLEL_API_KEY?.trim();
  return key ? message.split(key).join("[redacted]") : message;
}

export interface ImageSearchResponse {
  search_id: string;
  session_id?: string;
  results: { title: string | null; image_url: string; source_page_url: string; width: number | null; height: number | null }[];
  warnings?: unknown;
}

/** Image Search: POST /v1/images/search through the SDK client's authenticated transport. */
export async function imageSearch(client: Parallel, body: Record<string, unknown>): Promise<ImageSearchResponse> {
  return (await client.post("/v1/images/search", { body })) as ImageSearchResponse;
}
