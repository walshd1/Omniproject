import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { HealthWatch } from "./HealthWatch";
import type { HealthFinding } from "../../lib/health-watch";

/**
 * Health watch card: manager+ sees findings; only an admin can trigger a scan.
 */
const FINDINGS: HealthFinding[] = [
  { ruleId: "rag-red", projectId: "P1", projectName: "Apollo", severity: "critical", message: "RAG status is RED", at: "t" },
];

function seed(role: string | undefined, findings: HealthFinding[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["health-findings"], { findings });
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ findings: FINDINGS }) })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("HealthWatch", () => {
  it("is hidden for a viewer", () => {
    renderWithProviders(<HealthWatch />, { client: seed("viewer", []) });
    expect(screen.queryByTestId("health-watch")).not.toBeInTheDocument();
  });

  it("shows findings to a manager but no Run button", () => {
    renderWithProviders(<HealthWatch />, { client: seed("manager", FINDINGS) });
    expect(screen.getByTestId("health-findings")).toHaveTextContent("Apollo");
    expect(screen.queryByTestId("health-run")).not.toBeInTheDocument();
  });

  it("lets an admin trigger a scan", async () => {
    renderWithProviders(<HealthWatch />, { client: seed("admin", FINDINGS) });
    fireEvent.click(screen.getByTestId("health-run"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/health-watch/run"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("POST");
    });
  });

  it("shows the clear state with no findings", () => {
    renderWithProviders(<HealthWatch />, { client: seed("manager", []) });
    expect(screen.getByTestId("health-clear")).toBeInTheDocument();
  });
});
