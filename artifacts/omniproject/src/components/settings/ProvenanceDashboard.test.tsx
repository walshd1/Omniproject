import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ProvenanceDashboard } from "./ProvenanceDashboard";
import type { ProvenanceChain, ProvenanceEntry } from "../../lib/provenance";

/**
 * Admin broker-call provenance dashboard: admin-only; shows the chain verdict and the
 * session each call is bound to (or "system" when unauthenticated).
 */
function entry(p: Partial<ProvenanceEntry> & { seq: number; hop: ProvenanceEntry["hop"] }): ProvenanceEntry {
  return {
    callId: "call-aaaa", action: "listProjects", actor: "alice", sessionMac: "ab12cd34ef567890",
    tMono: "1", elapsedMs: 0, tWall: "t", kver: 1, contentMac: "cm", prevMac: null, mac: "m", ...p,
  };
}

const CHAIN: ProvenanceChain = {
  entries: [
    entry({ seq: 0, hop: "invoke" }),
    entry({ seq: 1, hop: "result", elapsedMs: 12 }),
    entry({ seq: 2, hop: "invoke", callId: "call-bbbb", action: "ping", actor: null, sessionMac: null }),
  ],
  chain: { ok: true, length: 3 },
};

function seed(role: string | undefined, data: ProvenanceChain = CHAIN): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["provenance-chain"], data);
  return qc;
}

describe("ProvenanceDashboard", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<ProvenanceDashboard />, { client: seed("viewer") });
    expect(screen.queryByTestId("provenance-dashboard")).not.toBeInTheDocument();
  });

  it("shows an intact verdict with the session-bound call count", () => {
    renderWithProviders(<ProvenanceDashboard />, { client: seed("admin") });
    expect(screen.getByTestId("provenance-dashboard")).toBeInTheDocument();
    // 1 of 2 calls is session-bound (the ping is a system call).
    expect(screen.getByTestId("chain-verdict")).toHaveTextContent(/1 of 2 calls session-bound/);
  });

  it("marks an authenticated call as session-bound and a system call as system", () => {
    renderWithProviders(<ProvenanceDashboard />, { client: seed("admin") });
    expect(screen.getAllByText(/session ab12cd34ef/).length).toBe(2); // invoke + result hops
    expect(screen.getByText("system")).toBeInTheDocument();
  });

  it("surfaces a broken chain", () => {
    const broken: ProvenanceChain = { entries: [entry({ seq: 0, hop: "invoke" })], chain: { ok: false, length: 1, brokenAt: 0, reason: "entry MAC mismatch (a field was altered)" } };
    renderWithProviders(<ProvenanceDashboard />, { client: seed("admin", broken) });
    expect(screen.getByTestId("chain-verdict")).toHaveTextContent(/BROKEN at seq 0/);
  });
});
