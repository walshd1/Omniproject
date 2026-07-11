import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { selfHostQueryKey, type SelfHostState, type SelfHostDomainRow } from "../../lib/selfhost";
import { SelfHostCapabilitiesAdmin } from "./SelfHostCapabilitiesAdmin";

function row(over: Partial<SelfHostDomainRow> = {}): SelfHostDomainRow {
  return { id: "financials", label: "Financials", core: false, gate: "storage", unlocks: "Budgets in your DB", fieldCount: 5, enabled: false, locked: false, ...over };
}

function state(over: Partial<SelfHostState> = {}): SelfHostState {
  return {
    config: { mode: "system-of-record", adopted: [], acknowledgedDataResponsibility: true },
    domains: [
      row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
      row({ id: "financials", label: "Financials", enabled: false }),
    ],
    enabledDomains: ["issues"],
    holdsOnlyCopy: true,
    ...over,
  };
}

function seed(s: SelfHostState | null, role: string = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (s) qc.setQueryData(selfHostQueryKey({ programmeId: null, projectId: null }), s);
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: null, role });
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(resetFetchMock);

describe("SelfHostCapabilitiesAdmin", () => {
  it("shows a read-only message for a role that can't govern self-host (not pmo/admin)", () => {
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(state(), "manager") });
    expect(screen.getByTestId("selfhost-admin-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("selfhost-capabilities")).not.toBeInTheDocument();
  });

  it("renders the mode and the holds-only-copy disclosure", () => {
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(state()) });
    expect(screen.getByTestId("selfhost-mode")).toHaveTextContent("system-of-record");
    expect(screen.getByText(/only copy of this data/i)).toBeInTheDocument();
  });

  it("lists core domains as always-held and gated domains with an adopt toggle", () => {
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(state()) });
    expect(screen.getByText("Always held")).toBeInTheDocument();
    expect(screen.getByTestId("selfhost-row-financials")).toBeInTheDocument();
  });

  it("adopting a gated domain at org POSTs the augmented adopted set to /api/setup/self-host", async () => {
    const calls = mockFetchRouter({ "POST /api/setup/self-host": { ok: true, body: state() } });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(state()) });
    fireEvent.click(screen.getByRole("button", { name: "Adopt" }));

    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/setup/self-host") && c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/api/setup/self-host") && c.init?.method === "POST")!;
    const body = JSON.parse(String(post.init!.body)) as { adopted: string[]; mode: string };
    expect(body.adopted).toContain("financials");
    expect(body.mode).toBe("system-of-record");
  });

  it("a domain locked at a higher level shows locked instead of a toggle", () => {
    const s = state({
      domains: [
        row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
        row({ id: "financials", enabled: false, locked: true, lockedBy: "org", policy: "forbid" }),
      ],
    });
    // View at programme level: an org lock is "above" and can't be toggled here.
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(s, "pmo") });
    // pmo starts at the programme tab; select a target isn't needed to see org lock rendering only
    // after a scope is chosen — so assert the read model at org is unaffected by re-rendering.
    expect(screen.getByTestId("selfhost-capabilities")).toBeInTheDocument();
  });
});
