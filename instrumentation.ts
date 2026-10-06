import type { Instrumentation } from "next";

/**
 * Next.js runs this for every unhandled server error (Server Components,
 * route handlers, server actions). We turn each into one structured, redacted
 * log line (so any log drain can alert on `event:"unhandled_server_error"`)
 * and, if configured, forward it to ERROR_WEBHOOK_URL.
 *
 * To add a hosted error tracker later (for example Sentry), initialise its SDK
 * here and call it from the same place: the call sites do not change.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { log } = await import("@/lib/observability/log");
  const err = error as Error & { digest?: string };
  log.error("unhandled_server_error", {
    message: err.message,
    digest: err.digest,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });

  const { forwardToErrorWebhook } = await import("@/lib/observability/report");
  await forwardToErrorWebhook(`Cachier POS error on ${request.method} ${request.path}: ${err.message}`);
};
