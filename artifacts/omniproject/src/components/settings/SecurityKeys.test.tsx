import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { SecurityKeys } from "./SecurityKeys";
import type { KeyStatus } from "../../lib/security";

/**
 * Admin key-revocation card: admin-only; lists keys; revoke calls the gateway.
 */
const KEYS: KeyStatus[] = [
  { name: "session", version: 1, revokedVersions: [], rotatedAt: null, lastActor: null, lastReason: null },
  { name: "provenance", version: 2, revokedVersions: [1], rotatedAt: "t", lastActor: "admin-1", lastReason: "rotation" },
];

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["security-keys"], { keys: KEYS });
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: KEYS }) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "prompt").mockReturnValue("compromise");
});
afterEach(() => vi.unstubAllGlobals());

describe("SecurityKeys", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<SecurityKeys />, { client: seed("viewer") });
    expect(screen.queryByTestId("security-keys")).not.toBeInTheDocument();
  });

  it("lists the keys with their version + revocation state", () => {
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    expect(screen.getByTestId("security-keys")).toBeInTheDocument();
    expect(screen.getByText("provenance")).toBeInTheDocument();
    expect(screen.getByText(/revoked 1/)).toBeInTheDocument();
  });

  it("revokes a key via POST when confirmed", async () => {
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("revoke-provenance"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/security/keys/provenance/revoke"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("POST");
    });
  });
});
