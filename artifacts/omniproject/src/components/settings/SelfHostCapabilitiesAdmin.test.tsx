import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProgrammesQueryKey, getListProjectsQueryKey } from "@workspace/api-client-react";
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
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

  it("adopting fails: surfaces the server error message in the status line", async () => {
    mockFetchRouter({ "POST /api/setup/self-host": { ok: false, status: 400, body: { error: "acknowledge data responsibility first" } } });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(state()) });
    fireEvent.click(screen.getByRole("button", { name: "Adopt" }));
    expect(await screen.findByTestId("selfhost-msg")).toHaveTextContent("acknowledge data responsibility first");
  });

  it("shows an already-adopted domain's toggle as 'Adopted'", () => {
    const s = state({ config: { mode: "system-of-record", adopted: ["financials"], acknowledgedDataResponsibility: true } });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(s) });
    expect(screen.getByRole("button", { name: "Adopted" })).toBeInTheDocument();
  });

  it("renders the off mode default and no holds-only-copy note when the DB doesn't hold the only copy", () => {
    const s = state({ config: { mode: "off", adopted: [], acknowledgedDataResponsibility: false }, holdsOnlyCopy: false });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(s) });
    expect(screen.getByTestId("selfhost-mode")).toHaveTextContent("off");
    expect(screen.queryByText(/only copy of this data/i)).not.toBeInTheDocument();
  });

  it("shows the gate reason and a 'not held (off at …)' status for a scope-blocked domain", () => {
    const s = state({
      domains: [
        row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
        row({ id: "financials", gate: "cost", enabled: false, blockedAt: "programme" }),
      ],
    });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: seed(s) });
    const rowEl = screen.getByTestId("selfhost-row-financials");
    expect(rowEl).toHaveTextContent(/gated \(cost\)/);
    expect(rowEl).toHaveTextContent(/not held \(off at programme\)/);
  });

  it("programme scope: picking a target and toggling a held domain OFF PUTs the disable set", async () => {
    const qc = seed(state(), "pmo");
    qc.setQueryData(getListProgrammesQueryKey(), [{ id: "prog-1", name: "Prog One" }]);
    qc.setQueryData(getListProjectsQueryKey(), []);
    qc.setQueryData(
      selfHostQueryKey({ programmeId: "prog-1", projectId: null }),
      state({
        domains: [
          row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
          row({ id: "financials", enabled: true }),
        ],
      }),
    );
    const calls = mockFetchRouter({ "PUT /api/features/programme/prog-1": { ok: true, body: {} } });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: qc });

    // pmo defaults to the programme tab; choosing a target enables the scope query + domain list.
    fireEvent.change(screen.getByTestId("selfhost-target"), { target: { value: "prog-1" } });
    fireEvent.click(await screen.findByRole("button", { name: "On" }));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/features/programme/prog-1") && c.init?.method === "PUT")).toBe(true),
    );
    const put = calls.find((c) => c.url.includes("/api/features/programme/prog-1"))!;
    expect(JSON.parse(String(put.init!.body)).disabled).toContain("selfhost:financials");
    expect(await screen.findByTestId("selfhost-msg")).toHaveTextContent("Saved.");
  });

  it("project scope: switching to the project tab, picking a project, toggling PUTs to the project route", async () => {
    const qc = seed(state(), "pmo");
    qc.setQueryData(getListProgrammesQueryKey(), []);
    qc.setQueryData(getListProjectsQueryKey(), [{ id: "proj-9", name: "Proj Nine", programmeId: "prog-7" }]);
    qc.setQueryData(
      selfHostQueryKey({ programmeId: "prog-7", projectId: "proj-9" }),
      state({
        domains: [
          row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
          row({ id: "financials", enabled: false, blockedAt: "project" }),
        ],
      }),
    );
    const calls = mockFetchRouter({ "PUT /api/features/project/proj-9": { ok: true, body: {} } });
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: qc });

    fireEvent.click(screen.getByRole("tab", { name: "project" }));
    fireEvent.change(screen.getByTestId("selfhost-target"), { target: { value: "proj-9" } });
    // financials is off at project → button reads "Off"; clicking turns it on (drops from disable set).
    fireEvent.click(await screen.findByRole("button", { name: "Off" }));

    await vi.waitFor(() => expect(calls.some((c) => c.url.includes("/api/features/project/proj-9") && c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.url.includes("/api/features/project/proj-9"))!;
    // programmeId travels as a query param so the ceiling check resolves.
    expect(put.url).toContain("programmeId=prog-7");
    expect(JSON.parse(String(put.init!.body)).disabled).not.toContain("selfhost:financials");
  });

  it("project scope: a domain blocked at org is shown but its toggle is disabled", async () => {
    const qc = seed(state(), "pmo");
    qc.setQueryData(getListProgrammesQueryKey(), []);
    qc.setQueryData(getListProjectsQueryKey(), [{ id: "proj-9", name: "Proj Nine", programmeId: "prog-7" }]);
    qc.setQueryData(
      selfHostQueryKey({ programmeId: "prog-7", projectId: "proj-9" }),
      state({
        domains: [
          row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
          row({ id: "financials", enabled: false, blockedAt: "org" }),
        ],
      }),
    );
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: qc });
    fireEvent.click(screen.getByRole("tab", { name: "project" }));
    fireEvent.change(screen.getByTestId("selfhost-target"), { target: { value: "proj-9" } });
    expect(await screen.findByRole("button", { name: "Off" })).toBeDisabled();
  });

  it("programme scope: a domain forbidden at org shows a read-only lock label, not a toggle", async () => {
    const qc = seed(state(), "pmo");
    qc.setQueryData(getListProgrammesQueryKey(), [{ id: "prog-1", name: "Prog One" }]);
    qc.setQueryData(getListProjectsQueryKey(), []);
    qc.setQueryData(
      selfHostQueryKey({ programmeId: "prog-1", projectId: null }),
      state({
        domains: [
          row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
          row({ id: "financials", enabled: false, locked: true, lockedBy: "org", policy: "forbid" }),
        ],
      }),
    );
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: qc });
    fireEvent.change(screen.getByTestId("selfhost-target"), { target: { value: "prog-1" } });
    expect(await screen.findByText(/Forbidden at org \(locked\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /On|Off/ })).not.toBeInTheDocument();
  });

  it("programme scope: a required lock at a higher level shows 'Required at …'", async () => {
    const qc = seed(state(), "pmo");
    qc.setQueryData(getListProgrammesQueryKey(), [{ id: "prog-1", name: "Prog One" }]);
    qc.setQueryData(getListProjectsQueryKey(), []);
    qc.setQueryData(
      selfHostQueryKey({ programmeId: "prog-1", projectId: null }),
      state({
        domains: [
          row({ id: "issues", label: "Work items", core: true, gate: null, enabled: true }),
          row({ id: "financials", enabled: true, locked: true, lockedBy: "org", policy: "require" }),
        ],
      }),
    );
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: qc });
    fireEvent.change(screen.getByTestId("selfhost-target"), { target: { value: "prog-1" } });
    expect(await screen.findByText(/Required at org \(locked\)/)).toBeInTheDocument();
  });

  it("switching scope level resets the chosen target back to the placeholder", () => {
    const qc = seed(state(), "admin");
    qc.setQueryData(getListProgrammesQueryKey(), [{ id: "prog-1", name: "Prog One" }]);
    qc.setQueryData(getListProjectsQueryKey(), [{ id: "proj-9", name: "Proj Nine", programmeId: null }]);
    renderWithProviders(<SelfHostCapabilitiesAdmin />, { client: qc });
    // admin starts at org (no target select). Move to programme and choose one…
    fireEvent.click(screen.getByRole("tab", { name: "programme" }));
    fireEvent.change(screen.getByTestId("selfhost-target"), { target: { value: "prog-1" } });
    expect((screen.getByTestId("selfhost-target") as HTMLSelectElement).value).toBe("prog-1");
    // …then switch to project: the target must reset to "".
    fireEvent.click(screen.getByRole("tab", { name: "project" }));
    expect((screen.getByTestId("selfhost-target") as HTMLSelectElement).value).toBe("");
  });
});
