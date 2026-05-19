import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "pp_session";

const PUBLIC_PATH_PREFIXES = [
  "/signin",
  "/api/auth/key",
  "/api/auth/logout",
  "/api/webhooks", // Parallel-signed callbacks
  "/api/cron",     // Vercel cron (separately authed via header)
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function readSession(token: string | undefined, secret: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (typeof payload.accountId !== "string") return null;
    return { accountId: payload.accountId };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("[middleware] SESSION_SECRET not set; rejecting request");
    return NextResponse.redirect(new URL("/signin?error=server_misconfigured", request.url));
  }

  const session = await readSession(
    request.cookies.get(COOKIE_NAME)?.value,
    secret,
  );

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = new URL("/signin", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
