import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { selfHostQueryKey, type SelfHostState } from "../../lib/selfhost";
import { SelfHostDbStep } from "./SelfHostDbStep";

function state(): SelfHostState {
  return {
    config: { mode: "off", adopted: [], acknowledgedDataResponsibility: false },
    domains: [
      { id: "issues", label: "Work items", core: true, gate: null, unlocks: "spine", fieldCount: 10, enabled: true, locked: false },
      { id: "financials", label: "Financials", core: false, gate: "storage", unlocks: "Budgets in your DB", fieldCount: 5, enabled: false, locked: false },
    ],
    enabledDomains: ["issues"],
    holdsOnlyCopy: false,
  };
}

function seed(role = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(selfHostQueryKey({}), state());
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: null, role });
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(resetFetchMock);

describe("SelfHostDbStep", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<SelfHostDbStep n={9} isAdmin={false} />, { client: seed("manager") });
    expect(screen.queryByTestId("selfhost-modes")).not.toBeInTheDocument();
  });

  it("offers the three modes and steers to connecting an existing tool", () => {
    renderWithProviders(<SelfHostDbStep n={9} isAdmin />, { client: seed() });
    expect(screen.getByTestId("selfhost-mode-off")).toBeInTheDocument();
    expect(screen.getByTestId("selfhost-mode-augmenting")).toBeInTheDocument();
    expect(screen.getByTestId("selfhost-mode-system-of-record")).toBeInTheDocument();
    expect(screen.getByText(/Prefer connecting your existing tool/i)).toBeInTheDocument();
  });

  it("off mode holds no copy, needs no ack, and Save is enabled", () => {
    renderWithProviders(<SelfHostDbStep n={9} isAdmin />, { client: seed() });
    expect(screen.queryByTestId("selfhost-ack")).not.toBeInTheDocument();
    expect(screen.getByTestId("selfhost-save")).toBeEnabled();
  });

  it("choosing system-of-record surfaces the ack + warnings and BLOCKS save until acknowledged", () => {
    renderWithProviders(<SelfHostDbStep n={9} isAdmin />, { client: seed() });
    fireEvent.click(screen.getByTestId("selfhost-mode-system-of-record"));
    // domain checkboxes + the block gate appear
    expect(screen.getByTestId("selfhost-domain-financials")).toBeInTheDocument();
    expect(screen.getByTestId("selfhost-warn-system-of-record-authority")).toBeInTheDocument();
    expect(screen.getByTestId("selfhost-ack")).toBeInTheDocument();
    expect(screen.getByTestId("selfhost-save")).toBeDisabled();
    expect(screen.getByTestId("selfhost-blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("selfhost-ack-input"));
    expect(screen.getByTestId("selfhost-save")).toBeEnabled();
  });

  it("saving an acknowledged adoption POSTs mode + adopted + ack", async () => {
    const calls = mockFetchRouter({ "POST /api/setup/self-host": { ok: true, body: state() } });
    renderWithProviders(<SelfHostDbStep n={9} isAdmin />, { client: seed() });
    fireEvent.click(screen.getByTestId("selfhost-mode-system-of-record"));
    fireEvent.click(screen.getByTestId("selfhost-domain-financials"));
    fireEvent.click(screen.getByTestId("selfhost-ack-input"));
    fireEvent.click(screen.getByTestId("selfhost-save"));

    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/setup/self-host") && c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/api/setup/self-host") && c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({
      mode: "system-of-record",
      adopted: ["financials"],
      acknowledgedDataResponsibility: true,
    });
  });
});
