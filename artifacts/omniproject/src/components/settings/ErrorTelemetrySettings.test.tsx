import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey, type Settings } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ErrorTelemetrySettings } from "./ErrorTelemetrySettings";

function settings(over: Partial<Settings> = {}): Settings {
  return {
    brokerUrl: null, aiProvider: "none", aiModel: null, backendSource: "all", oidcIssuerUrl: null,
    errorTelemetry: false,
    ...over,
  } as Settings;
}

function seeded(s: Settings): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(getGetSettingsQueryKey(), s);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ErrorTelemetrySettings", () => {
  it("renders Off by default and offers Enable", () => {
    renderWithProviders(<ErrorTelemetrySettings />, { client: seeded(settings()) });
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByTestId("error-telemetry-enable")).toBeInTheDocument();
  });

  it("shows the Disable control when already enabled", () => {
    renderWithProviders(<ErrorTelemetrySettings />, { client: seeded(settings({ errorTelemetry: true })) });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByTestId("error-telemetry-disable")).toBeInTheDocument();
  });

  it("PATCHes settings with errorTelemetry:true when Enable is clicked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(settings({ errorTelemetry: true })), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    renderWithProviders(<ErrorTelemetrySettings />, { client: seeded(settings()) });

    await userEvent.click(screen.getByTestId("error-telemetry-enable"));

    const patchCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(call).toBeTruthy();
      return call!;
    });
    const [url, init] = patchCall;
    expect(String(url)).toMatch(/\/settings$/);
    expect(JSON.parse(String(init?.body))).toMatchObject({ errorTelemetry: true });
  });
});
