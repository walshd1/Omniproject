import { useEffect } from "react";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "../lib/auth";
import { setErrorTelemetryEnabled } from "../lib/error-telemetry";

/**
 * Headless: mirrors the admin `errorTelemetry` setting into the module singleton the
 * class-component ErrorBoundary reads synchronously at catch time. The settings query only
 * runs once authenticated (GET /settings needs a session), so this never fires an
 * unauthenticated request; while logged out or with telemetry off, the flag stays false.
 */
export function ErrorTelemetrySync() {
  const { data: auth } = useAuth();
  const authed = !!auth?.authenticated;
  const { data: settings } = useGetSettings({ query: { enabled: authed, queryKey: getGetSettingsQueryKey() } });
  useEffect(() => {
    setErrorTelemetryEnabled(authed && !!settings?.errorTelemetry);
  }, [authed, settings?.errorTelemetry]);
  return null;
}
