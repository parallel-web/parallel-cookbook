/**
 * Minimal stub for `next/server` so the dashboard route handlers can be
 * unit-tested by the Node vitest runner without pulling Next.js into the
 * test graph. Only the surface area used by our route files is implemented.
 */
export class NextRequest extends Request {
  public readonly nextUrl: URL & { searchParams: URLSearchParams };

  constructor(input: Request | string, init?: RequestInit) {
    if (typeof input === "string") {
      super(input, init);
    } else {
      super(input, init);
    }
    const url = new URL(this.url);
    this.nextUrl = url as URL & { searchParams: URLSearchParams };
  }
}

export const NextResponse = {
  json(body: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(body), { ...init, headers });
  },
  redirect(url: string, init?: ResponseInit): Response {
    return Response.redirect(url, (init?.status as 301 | 302 | 303 | 307 | 308 | undefined) ?? 307);
  },
};
