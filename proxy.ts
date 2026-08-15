import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

// Next 16 renamed `middleware` to `proxy` — same contract as Nuxt's
// global route middleware: runs before every matched request.
// Order: next-intl resolves the locale → Supabase refreshes the session
// → session-presence gate. Role checks stay server-side (RLS + layouts);
// the middleware never touches the database.
export default async function proxy(request: NextRequest) {
  const i18nResponse = handleI18nRouting(request);
  const { response, user } = await updateSession(request, i18nResponse);

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const hasLocale = (routing.locales as readonly string[]).includes(segments[0]);
  const locale = hasLocale ? segments[0] : routing.defaultLocale;
  const path = "/" + segments.slice(hasLocale ? 1 : 0).join("/");

  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    // keep any freshly rotated auth cookies on the redirect response
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
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
