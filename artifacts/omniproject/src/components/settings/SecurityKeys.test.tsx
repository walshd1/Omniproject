import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("revokes a key via POST behind a confirm dialog, once confirmed", async () => {
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("revoke-provenance")); // opens the confirm dialog
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /revoke & rotate/i })); // confirm
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/security/keys/provenance/revoke"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("POST");
    });
  });

  it("carries a typed reason from the dialog's input into the revoke request", async () => {
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("revoke-provenance"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for revoking the provenance key/i), { target: { value: "compromised laptop" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /revoke & rotate/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/security/keys/provenance/revoke"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ reason: "compromised laptop" });
    });
  });

  it("does not fire the revoke when the dialog is cancelled", async () => {
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("revoke-provenance"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/revoke"))).toBe(false);
  });
});
