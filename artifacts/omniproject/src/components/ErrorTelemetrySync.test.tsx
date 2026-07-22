import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { ErrorTelemetrySync } from "./ErrorTelemetrySync";
import { errorTelemetryKey } from "../lib/error-telemetry-api";
import { isErrorTelemetryEnabled, setErrorTelemetryEnabled } from "../lib/error-telemetry";

/**
 * Headless sync: mirrors the admin error-telemetry opt-in into the module singleton the
 * class-component ErrorBoundary reads synchronously. It must only report ON when the session
 * is authenticated AND the server value (the `error-telemetry` config def) is on — otherwise
 * the flag stays false.
 */
function seed(opts: { authed?: boolean; errorTelemetry?: boolean; seedSettings?: boolean } = {}): QueryClient {
  const { authed = true, errorTelemetry = true, seedSettings = true } = opts;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: authed, mode: "demo", user: { sub: "u1" }, role: "admin" });
  if (seedSettings) qc.setQueryData(errorTelemetryKey, { errorTelemetry });
  return qc;
}

beforeEach(() => {
  setErrorTelemetryEnabled(false);
  // Any incidental provider fetch (branding/i18n) resolves to an empty body.
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
});

afterEach(() => {
  setErrorTelemetryEnabled(false);
  vi.restoreAllMocks();
});

describe("ErrorTelemetrySync", () => {
  it("renders nothing (headless)", () => {
    const { container } = renderWithProviders(<ErrorTelemetrySync />, { client: seed() });
    expect(container).toBeEmptyDOMElement();
  });

  it("turns the flag ON when authenticated and the server setting is enabled", () => {
    renderWithProviders(<ErrorTelemetrySync />, { client: seed({ authed: true, errorTelemetry: true }) });
    expect(isErrorTelemetryEnabled()).toBe(true);
  });

  it("keeps the flag OFF when authenticated but the server setting is disabled", () => {
    renderWithProviders(<ErrorTelemetrySync />, { client: seed({ authed: true, errorTelemetry: false }) });
    expect(isErrorTelemetryEnabled()).toBe(false);
  });

  it("keeps the flag OFF when unauthenticated even if the cached setting says enabled", () => {
    // The `authed && …` guard must win: a logged-out session never reports telemetry.
    renderWithProviders(<ErrorTelemetrySync />, { client: seed({ authed: false, errorTelemetry: true }) });
    expect(isErrorTelemetryEnabled()).toBe(false);
  });

  it("treats a missing payload as OFF (nullish → false)", () => {
    renderWithProviders(<ErrorTelemetrySync />, { client: seed({ authed: true, seedSettings: false }) });
    expect(isErrorTelemetryEnabled()).toBe(false);
  });

  it("re-syncs when the server value flips off (effect re-runs on the dependency change)", () => {
    const qc = seed({ authed: true, errorTelemetry: true });
    renderWithProviders(<ErrorTelemetrySync />, { client: qc });
    expect(isErrorTelemetryEnabled()).toBe(true);
    // Flip the cached value; the effect's dep (the resolved boolean) changes → it re-runs.
    qc.setQueryData(errorTelemetryKey, { errorTelemetry: false });
    renderWithProviders(<ErrorTelemetrySync />, { client: qc });
    expect(isErrorTelemetryEnabled()).toBe(false);
  });
});
