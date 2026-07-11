import { sendJson } from "./api";

/**
 * Client-error telemetry — OFF unless an admin turns it on (Settings → Diagnostics).
 *
 * The enabled flag is cached in this module so the class-component ErrorBoundary (which can't
 * use hooks) can read it synchronously at catch time. `ErrorTelemetrySync` keeps it in step with
 * the server setting. When enabled, an uncaught render error is POSTed to the gateway's internal
 * `/api/client-errors` sink (audit log) — message + component stack + page only, never user data.
 * Best-effort: any failure is swallowed so error reporting can never itself surface an error.
 */
let enabled = false;

/** Set by the settings sync; the ErrorBoundary reads it via `isErrorTelemetryEnabled`. */
export function setErrorTelemetryEnabled(value: boolean): void {
  enabled = value;
}

export function isErrorTelemetryEnabled(): boolean {
  return enabled;
}

/** Report an uncaught render error, if (and only if) telemetry is enabled. Never throws. */
export function reportClientError(report: { message: string; componentStack?: string | undefined }): void {
  if (!enabled) return;
  const payload = {
    message: report.message,
    ...(report.componentStack ? { componentStack: report.componentStack } : {}),
    page: typeof window !== "undefined" ? window.location.pathname : "",
  };
  // Fire-and-forget; the gate is also enforced server-side, so a stale flag is harmless.
  void sendJson("/api/client-errors", payload, "POST").catch(() => {});
}
