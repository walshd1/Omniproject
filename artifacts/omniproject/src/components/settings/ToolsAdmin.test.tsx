import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ToolsAdmin } from "./ToolsAdmin";
import type { ResolvedTool, ToolPolicy } from "../../lib/tools";

/**
 * Admin governance card: hidden for non-admins; lets an admin relax the egress policy
 * (which the gateway persists + enforces).
 */
const TOOLS: ResolvedTool[] = [
  { id: "whisper-dictation", label: "Voice dictation (Whisper)", description: "STT", egressModes: ["none", "self-hosted", "third-party"], available: true, effectiveEgress: "none", requiresConsent: false, consented: false, reason: null },
  { id: "portfolio-copilot", label: "Portfolio copilot", description: "Q&A", egressModes: ["self-hosted", "third-party"], available: false, effectiveEgress: null, requiresConsent: false, consented: false, reason: "blocked by the data-egress policy" },
];
const POLICY: ToolPolicy = { allowedEgress: ["none"], disabled: [] };

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["tools"], { tools: TOOLS, policy: POLICY });
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ToolsAdmin", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<ToolsAdmin />, { client: seed("viewer") });
    expect(screen.queryByTestId("tools-admin")).not.toBeInTheDocument();
  });

  it("shows the governance card for an admin with the tools listed", () => {
    renderWithProviders(<ToolsAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("tools-admin")).toBeInTheDocument();
    expect(screen.getByText("Voice dictation (Whisper)")).toBeInTheDocument();
    expect(screen.getByText("Portfolio copilot")).toBeInTheDocument();
  });

  it("relaxes the egress policy via PUT when an admin enables a class", async () => {
    renderWithProviders(<ToolsAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByLabelText("Your own infrastructure"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tools/policy", expect.objectContaining({ method: "PUT" })));
    const putCall = fetchMock.mock.calls.find((c) => c[0] === "/api/tools/policy")!;
    const body = JSON.parse((putCall[1] as { body: string }).body);
    expect(body.allowedEgress).toContain("self-hosted");
  });
});
