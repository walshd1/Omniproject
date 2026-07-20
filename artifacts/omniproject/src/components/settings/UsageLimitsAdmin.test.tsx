import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { UsageLimitsAdmin } from "./UsageLimitsAdmin";
import type { UsageReport } from "../../lib/usage";

/**
 * Usage & limits admin: pmo/admin sees per-vendor volume (hour/day/month), a limit warning badge,
 * cost, and can edit + save policies and trigger the notification.
 */
const REPORT: UsageReport = {
  generatedAt: "t",
  vendors: [
    {
      vendor: "openai",
      series: { hour: [], day: [], month: [] },
      totals: { hour: { calls: 2, tokens: 800 }, day: { calls: 5, tokens: 1800 }, month: { calls: 9, tokens: 3000 } },
      limit: { period: "day", metric: "tokens", max: 2000, used: 1800, fraction: 0.9, level: "critical" },
      cost: { currency: "USD", day: 0.9, month: 1.5 },
      policy: { limit: { period: "day", metric: "tokens", max: 2000 }, cost: { per: "ktoken", amount: 0.5, currency: "USD" } },
    },
  ],
};

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["usage-report"], REPORT);
  qc.setQueryData(["usage-policies"], { usagePolicies: { openai: REPORT.vendors[0]!.policy } });
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ worst: "critical", flagged: [], notified: true }) })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("UsageLimitsAdmin", () => {
  it("is hidden for a viewer", () => {
    renderWithProviders(<UsageLimitsAdmin />, { client: seed("viewer") });
    expect(screen.queryByTestId("usage-limits")).not.toBeInTheDocument();
  });

  it("surfaces per-vendor totals by hour/day/month, the limit badge and cost", () => {
    renderWithProviders(<UsageLimitsAdmin />, { client: seed("admin") });
    const row = screen.getByTestId("usage-vendor-openai");
    expect(row).toHaveTextContent("2 calls"); // hour
    expect(row).toHaveTextContent("1,800 tokens"); // day tokens
    expect(screen.getByTestId("usage-badge-openai")).toHaveTextContent("90% of day tokens");
    expect(screen.getByTestId("usage-cost-openai")).toHaveTextContent("USD 0.90 today");
  });

  it("editing a limit reveals Save and persists via PUT", async () => {
    renderWithProviders(<UsageLimitsAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("openai limit max"), { target: { value: "5000" } });
    fireEvent.click(screen.getByTestId("usage-save"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/usage/policies"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("PUT");
    });
  });

  it("Notify me POSTs the notification shortcut", async () => {
    renderWithProviders(<UsageLimitsAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("usage-notify"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/usage/notify"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("POST");
    });
  });

  it("can add a new vendor to pre-set a policy", () => {
    renderWithProviders(<UsageLimitsAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByTestId("usage-add-input"), { target: { value: "anthropic" } });
    fireEvent.click(screen.getByTestId("usage-add"));
    expect(screen.getByTestId("usage-vendor-anthropic")).toBeInTheDocument();
  });
});
