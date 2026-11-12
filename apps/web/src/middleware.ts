// Fast check before staff pages render: no session cookie means straight to
// sign-in, remembering the page so people land back on it. This only looks
// for the cookie; the real check (valid session, staff record, permissions)
// still happens on the server in requireStaff().
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = ["/sign-in", "/forgot-password", "/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (getSessionCookie(request, { cookiePrefix: "vetrix" })) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the auth API, Next.js assets and static files.
  matcher: ["/((?!api/|_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
