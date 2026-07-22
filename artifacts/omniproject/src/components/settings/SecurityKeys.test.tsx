import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { Toaster } from "../ui/toaster";
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
  qc.setQueryData(["audit-log"], { retained: 1234, retentionDays: 90, oldest: "2026-01-01T00:00:00Z", newest: "2026-07-17T00:00:00Z", durable: true, cap: 200000 });
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

  it("revoking the session key logs the current user out instead of refreshing the keys list", async () => {
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("revoke-session"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /revoke & rotate/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/auth/logout"))).toBe(true);
    });
  });

  it("shows an error toast when revoking a key fails", async () => {
    fetchMock = vi.fn((url: string) =>
      String(url).includes("/revoke")
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "vault locked" }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: KEYS }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(
      <>
        <SecurityKeys />
        <Toaster />
      </>,
      { client: seed("admin") },
    );
    fireEvent.click(screen.getByTestId("revoke-provenance"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /revoke & rotate/i }));
    expect(await screen.findByText("Couldn't revoke key")).toBeInTheDocument();
    expect(screen.getByText("vault locked")).toBeInTheDocument();
  });
});

/**
 * The maintenance lockdown, config-export, and user-session-revocation flows each hit their
 * own endpoint (not just /api/security/keys), so these use mockFetchRouter to give each path
 * its own canned response instead of one blanket stub.
 */
describe("SecurityKeys — maintenance, export, and session actions", () => {
  afterEach(resetFetchMock);

  it("engages read-only maintenance lockdown behind a confirm dialog, with the typed reason", async () => {
    const calls = mockFetchRouter({
      "GET /api/admin/maintenance": { ok: true, body: { engaged: true, reason: "incident" } },
    });
    const qc = seed("admin");
    qc.setQueryData(["maintenance"], { engaged: false, reason: "" });
    renderWithProviders(<SecurityKeys />, { client: qc });

    fireEvent.change(screen.getByLabelText(/maintenance reason/i), { target: { value: "incident" } });
    fireEvent.click(screen.getByTestId("maintenance-engage"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /engage read-only/i }));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/admin/maintenance") && c.init?.method === "PUT");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init!.body))).toEqual({ engaged: true, reason: "incident" });
    });
    expect(await screen.findByTestId("maintenance-release")).toBeInTheDocument();
  });

  it("shows the audit evidence log status and disposes it behind a confirm + step-up", async () => {
    const calls = mockFetchRouter({
      "POST /api/security/audit/log/dispose": { ok: true, body: { disposed: 12, remaining: 1222 } },
    });
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });
    expect(screen.getByTestId("audit-log")).toBeInTheDocument();
    expect(screen.getByText(/1,234 retained event/)).toBeInTheDocument();
    expect(screen.getByText(/retention 90 day/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dispose-audit-log"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /dispose now/i }));
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/security/audit/log/dispose") && c.init?.method === "POST");
      expect(call).toBeTruthy();
    });
  });

  it("lifts maintenance lockdown directly (no confirm dialog) when already engaged", async () => {
    const calls = mockFetchRouter({});
    const qc = seed("admin");
    qc.setQueryData(["maintenance"], { engaged: true, reason: "incident" });
    renderWithProviders(<SecurityKeys />, { client: qc });

    fireEvent.click(screen.getByTestId("maintenance-release"));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/admin/maintenance") && c.init?.method === "PUT");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init!.body))).toEqual({ engaged: false, reason: "" });
    });
  });

  it("exports the config bundle behind a confirm dialog and reveals the one-time key + bundle", async () => {
    mockFetchRouter({
      "POST /api/security/config/export": {
        ok: true,
        body: { bundle: "e1.ABCDEF", exportKey: "k-once", warning: "Carry this separately." },
      },
    });
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });

    fireEvent.click(screen.getByTestId("export-config-key"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^export$/i }));

    expect(await screen.findByTestId("exported-key")).toBeInTheDocument();
    expect(screen.getByText("Carry this separately.")).toBeInTheDocument();
    expect(screen.getByText("k-once")).toBeInTheDocument();
    expect(screen.getByText("e1.ABCDEF")).toBeInTheDocument();
  });

  it("revokes a user's sessions by sub and clears the input on success", async () => {
    const calls = mockFetchRouter({
      "POST /api/security/sessions/revoke-user": { ok: true, body: {} },
    });
    renderWithProviders(<SecurityKeys />, { client: seed("admin") });

    fireEvent.change(screen.getByLabelText(/user id to revoke sessions for/i), { target: { value: "u-42" } });
    fireEvent.click(screen.getByRole("button", { name: /revoke user's sessions/i }));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/security/sessions/revoke-user"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init!.body))).toEqual({ sub: "u-42" });
    });
    await waitFor(() => expect(screen.getByLabelText(/user id to revoke sessions for/i)).toHaveValue(""));
  });

  it("shows an error toast when revoking a user's sessions fails, and keeps the typed id", async () => {
    mockFetchRouter({
      "POST /api/security/sessions/revoke-user": { ok: false, status: 500, body: { error: "db down" } },
    });
    renderWithProviders(
      <>
        <SecurityKeys />
        <Toaster />
      </>,
      { client: seed("admin") },
    );

    fireEvent.change(screen.getByLabelText(/user id to revoke sessions for/i), { target: { value: "u-42" } });
    fireEvent.click(screen.getByRole("button", { name: /revoke user's sessions/i }));

    expect(await screen.findByText("Couldn't revoke sessions")).toBeInTheDocument();
    expect(screen.getByText("db down")).toBeInTheDocument();
    expect(screen.getByLabelText(/user id to revoke sessions for/i)).toHaveValue("u-42");
  });
});
