import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "@workspace/backend-catalogue";
import type { A11yPrefs } from "../../lib/a11y-prefs";

/**
 * NotificationPreferences is a thin renderer over the `useA11yPrefs` context: every control reads
 * `prefs.notifications` and calls `setNotifications` with the patched value. We mock the hook and assert the
 * setter fires with the right shape for a channel toggle, a per-kind mute, and the quiet-hours reveal — plus
 * that a `critical` kind's mute switch is locked on (the server never lets it be silenced).
 */
const h = vi.hoisted(() => ({
  notifications: { current: null as unknown as NotificationPrefs },
  setNotifications: vi.fn(),
}));

vi.mock("../../lib/a11y-prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/a11y-prefs")>();
  return {
    ...actual,
    useA11yPrefs: () => ({ prefs: { notifications: h.notifications.current } as A11yPrefs, setNotifications: h.setNotifications }),
  };
});

import { NotificationPreferences } from "./NotificationPreferences";

function setPrefs(over: Partial<NotificationPrefs> = {}) {
  h.notifications.current = { ...DEFAULT_NOTIFICATION_PREFS, ...over };
}

beforeEach(() => {
  h.setNotifications.mockClear();
  setPrefs();
});

describe("NotificationPreferences", () => {
  it("toggling a channel off calls setNotifications with that channel disabled", () => {
    render(<NotificationPreferences />);
    fireEvent.click(screen.getByRole("switch", { name: /^Push/i }));
    expect(h.setNotifications).toHaveBeenCalledWith(expect.objectContaining({ channels: expect.objectContaining({ push: false }) }));
  });

  it("turning an event type off adds its kind to mutedKinds", () => {
    render(<NotificationPreferences />);
    // "Mention" is a non-critical kind → its switch starts ON (not muted); clicking it mutes the kind.
    fireEvent.click(screen.getByRole("switch", { name: /Mention/i }));
    expect(h.setNotifications).toHaveBeenCalledWith(expect.objectContaining({ mutedKinds: ["mention"] }));
  });

  it("a critical kind's mute switch is checked and disabled (can't be silenced)", () => {
    render(<NotificationPreferences />);
    const incident = screen.getByRole("switch", { name: /Incident/i });
    expect(incident).toBeChecked();
    expect(incident).toBeDisabled();
  });

  it("enabling quiet hours reveals the time inputs and persists the flag", () => {
    render(<NotificationPreferences />);
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /overnight/i }));
    expect(h.setNotifications).toHaveBeenCalledWith(expect.objectContaining({ quietHours: expect.objectContaining({ enabled: true }) }));
    // With quiet hours already on, the time inputs render.
    setPrefs({ quietHours: { enabled: true, start: "22:00", end: "07:00" } });
    render(<NotificationPreferences />);
    expect(screen.getByLabelText("From")).toHaveValue("22:00");
  });
});
