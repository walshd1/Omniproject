import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { SupervisedBatchApprovals } from "./SupervisedBatchApprovals";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

const PENDING = [
  {
    proposalId: "p1",
    batchId: "b1",
    createdAt: "2026-07-29T00:00:00Z",
    plan: { scope: { kind: "project", projectId: "P1" }, actions: [{ kind: "notify", params: {} }, { kind: "set-status", params: {} }] },
    preview: [{ kind: "notify", allowed: true }, { kind: "set-status", allowed: true }],
  },
];

afterEach(() => vi.unstubAllGlobals());

/** Install a fake WebAuthn-capable browser returning a canned assertion. */
function stubWebAuthn(get: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { get }, userAgent: "test" });
}

describe("SupervisedBatchApprovals", () => {
  it("lists pending batches with their preview + approve/abort controls", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ pending: PENDING }))));
    renderWithProviders(<SupervisedBatchApprovals />);
    await waitFor(() => expect(screen.getByText("set-status")).toBeInTheDocument());
    expect(screen.getByText("notify")).toBeInTheDocument();
    expect(screen.getByTestId("approve-p1")).toBeInTheDocument();
    expect(screen.getByTestId("abort-p1")).toBeInTheDocument();
  });

  it("shows an empty state when nothing awaits approval", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ pending: [] }))));
    renderWithProviders(<SupervisedBatchApprovals />);
    await waitFor(() => expect(screen.getByText(/No batches are awaiting/i)).toBeInTheDocument());
  });

  it("approving a batch fetches a challenge then posts a passkey-signed approve decision", async () => {
    const get = vi.fn(() =>
      Promise.resolve({
        rawId: new Uint8Array([1, 2, 3]).buffer,
        response: {
          clientDataJSON: new Uint8Array([4]).buffer,
          authenticatorData: new Uint8Array([5]).buffer,
          signature: new Uint8Array([6]).buffer,
        },
      }),
    );
    stubWebAuthn(get);
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ url: String(url), method: opts?.method, body: opts?.body });
      if (String(url).includes("/pending")) return Promise.resolve(jsonResponse({ pending: PENDING }));
      if (String(url).includes("/challenge")) return Promise.resolve(jsonResponse({ challenge: "AA", rpId: "localhost", stageId: "s1" }));
      if (String(url).includes("/decision")) return Promise.resolve(jsonResponse({ status: "approved" }));
      return Promise.resolve(jsonResponse({}));
    }));

    renderWithProviders(<SupervisedBatchApprovals />);
    await waitFor(() => expect(screen.getByTestId("approve-p1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("approve-p1"));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/approvals/p1/decision") && c.method === "POST")).toBe(true),
    );
    expect(get).toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/api/approvals/p1/challenge"))).toBe(true);
    const decision = calls.find((c) => c.url.includes("/decision"));
    expect(String(decision?.body)).toContain("approve");
  });
});
