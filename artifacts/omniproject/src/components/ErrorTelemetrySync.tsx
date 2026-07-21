import { useEffect } from "react";
import { useAuth } from "../lib/auth";
import { setErrorTelemetryEnabled } from "../lib/error-telemetry";
import { useErrorTelemetry } from "../lib/error-telemetry-api";

/**
 * Headless: mirrors the admin error-telemetry opt-in into the module singleton the
 * class-component ErrorBoundary reads synchronously at catch time. The value comes from the
 * `error-telemetry` config def (GET /api/error-telemetry), fetched only once authenticated, so
 * this never fires an unauthenticated request; while logged out or with telemetry off, the flag
 * stays false.
 */
export function ErrorTelemetrySync() {
  const { data: auth } = useAuth();
  const authed = !!auth?.authenticated;
  const { data: enabled } = useErrorTelemetry(authed);
  useEffect(() => {
    setErrorTelemetryEnabled(authed && enabled);
  }, [authed, enabled]);
  return null;
}
