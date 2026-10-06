import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { SUPABASE_URL } from "./lib/supabase/env";
import { updateSession } from "./lib/supabase/proxy";
import { buildCsp, cspHeaderName, cspMode, newNonce } from "./lib/security/csp";

const handleI18nRouting = createMiddleware(routing);

// Next 16 renamed `middleware` to `proxy` — same contract as Nuxt's
// global route middleware: runs before every matched request.
// Order: next-intl resolves the locale → Supabase refreshes the session
// → session-presence gate. Role checks stay server-side (RLS + layouts);
// the middleware never touches the database.
export default async function proxy(request: NextRequest) {
  // Per-request CSP nonce. Next.js reads the nonce from the REQUEST's CSP
  // header and stamps it on its own scripts, so set it before routing runs.
  const nonce = newNonce();
  const mode = cspMode(process.env.CSP_MODE);
  const cspName = cspHeaderName(mode);
  const csp = buildCsp({ nonce, supabaseUrl: SUPABASE_URL, dev: process.env.NODE_ENV !== "production", enforce: mode === "enforce" });
  request.headers.set("x-nonce", nonce);
  request.headers.set(cspName, csp);

  const i18nResponse = handleI18nRouting(request);
  const { response, user } = await updateSession(request, i18nResponse);
  response.headers.set(cspName, csp);

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const hasLocale = (routing.locales as readonly string[]).includes(segments[0]);
  const locale = hasLocale ? segments[0] : routing.defaultLocale;
  const path = "/" + segments.slice(hasLocale ? 1 : 0).join("/");

  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    // keep any freshly rotated auth cookies on the redirect response
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set(cspName, csp);
    return redirect;
  };

  if (!user && path !== "/login") return redirectTo(`/${locale}/login`);
  if (user && path === "/login") return redirectTo(`/${locale}`);

  return response;
}

export const config = {
  // Skip API routes, Next internals and static files (anything with a dot).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
