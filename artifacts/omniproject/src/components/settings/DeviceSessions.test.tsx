import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { DeviceSession } from "../../lib/sessions";

/**
 * DeviceSessions renders the caller's sessions over the mocked `lib/sessions` client and drives revoke /
 * sign-out-others. We assert the current session is flagged, a device can be signed out, and "sign out all
 * other devices" calls the right endpoint. describeDevice stays the real implementation (pure display).
 */
const h = vi.hoisted(() => ({
  sessions: [] as DeviceSession[],
  revoke: vi.fn(),
  revokeOthers: vi.fn(),
}));

vi.mock("../../lib/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/sessions")>();
  return {
    ...actual,
    useSessions: () => ({ data: { sessions: h.sessions }, isLoading: false }),
    revokeSession: h.revoke,
    revokeOtherSessions: h.revokeOthers,
  };
});

import { DeviceSessions } from "./DeviceSessions";

const CHROME = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Safari/604.1";

beforeEach(() => {
  h.revoke.mockReset(); h.revokeOthers.mockReset();
  h.sessions = [
    { id: "aaaa1111", current: true, firstSeen: Date.now() - 3_600_000, lastSeen: Date.now(), userAgent: CHROME, ip: "1.2.3.4" },
    { id: "bbbb2222", current: false, firstSeen: Date.now() - 86_400_000, lastSeen: Date.now() - 7_200_000, userAgent: SAFARI_IOS, ip: "5.6.7.8" },
  ];
});

describe("DeviceSessions", () => {
  it("lists sessions, flags the current device, and parses a friendly device label", () => {
    renderWithProviders(<DeviceSessions />);
    expect(screen.getByText(/Chrome on Windows/)).toBeInTheDocument();
    expect(screen.getByText(/Safari on iOS/)).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("signs out another device via its handle and refreshes", async () => {
    h.revoke.mockResolvedValue({ ok: true, current: false });
    renderWithProviders(<DeviceSessions />);
    // The non-current device's button reads "Sign out device".
    fireEvent.click(screen.getByRole("button", { name: /sign out device/i }));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith("bbbb2222"));
  });

  it("offers 'sign out all other devices' only when others exist, and calls the endpoint", async () => {
    h.revokeOthers.mockResolvedValue({ ok: true, revoked: 1 });
    renderWithProviders(<DeviceSessions />);
    fireEvent.click(screen.getByRole("button", { name: /sign out all other devices/i }));
    await waitFor(() => expect(h.revokeOthers).toHaveBeenCalled());
  });

  it("hides the bulk button when the current device is the only session", () => {
    h.sessions = [{ id: "aaaa1111", current: true, firstSeen: Date.now(), lastSeen: Date.now(), userAgent: CHROME }];
    renderWithProviders(<DeviceSessions />);
    expect(screen.queryByRole("button", { name: /sign out all other devices/i })).not.toBeInTheDocument();
  });
});
