import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { ErrorTelemetrySettings } from "./ErrorTelemetrySettings";
import { errorTelemetryKey } from "../../lib/error-telemetry-api";

// The panel reads/writes the `error-telemetry` config def at /api/error-telemetry (roadmap Phase C), not
// PATCH /settings. Seed its query cache directly and assert the PUT it fires.
function seeded(errorTelemetry: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(errorTelemetryKey, { errorTelemetry });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ErrorTelemetrySettings", () => {
  it("renders Off by default and offers Enable", () => {
    renderWithProviders(<ErrorTelemetrySettings />, { client: seeded(false) });
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByTestId("error-telemetry-enable")).toBeInTheDocument();
  });

  it("shows the Disable control when already enabled", () => {
    renderWithProviders(<ErrorTelemetrySettings />, { client: seeded(true) });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByTestId("error-telemetry-disable")).toBeInTheDocument();
  });

  it("PUTs /api/error-telemetry with errorTelemetry:true when Enable is clicked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errorTelemetry: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    renderWithProviders(<ErrorTelemetrySettings />, { client: seeded(false) });

    await userEvent.click(screen.getByTestId("error-telemetry-enable"));

    const putCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const [url, init] = putCall;
    expect(String(url)).toMatch(/\/api\/error-telemetry$/);
    expect(JSON.parse(String(init?.body))).toMatchObject({ errorTelemetry: true });
  });
});
