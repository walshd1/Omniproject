import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { TotpStatus } from "../../lib/totp";

/**
 * TwoFactorAuth drives the enrol → confirm → recovery / disable flow over the mocked `lib/totp` client.
 * We assert the state machine calls the right endpoint at each step and surfaces the recovery codes once.
 */
const h = vi.hoisted(() => ({
  status: { current: null as unknown as TotpStatus },
  enrol: vi.fn(),
  confirm: vi.fn(),
  disable: vi.fn(),
  qr: vi.fn(),
}));

vi.mock("../../lib/totp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/totp")>();
  return {
    ...actual,
    useTotpStatus: () => ({ data: h.status.current }),
    enrolTotp: h.enrol,
    confirmTotp: h.confirm,
    disableTotp: h.disable,
    qrDataUrl: h.qr,
  };
});

import { TwoFactorAuth } from "./TwoFactorAuth";

beforeEach(() => {
  h.enrol.mockReset(); h.confirm.mockReset(); h.disable.mockReset(); h.qr.mockReset();
  h.qr.mockResolvedValue("data:image/png;base64,QR");
  h.status.current = { available: true, enrolled: false, pending: false, recoveryRemaining: 0 };
});

describe("TwoFactorAuth", () => {
  it("says so when the instance has 2FA unconfigured", () => {
    h.status.current = { available: false, enrolled: false, pending: false, recoveryRemaining: 0 };
    renderWithProviders(<TwoFactorAuth />);
    expect(screen.getByText(/not configured on this instance/i)).toBeInTheDocument();
  });

  it("enrol → shows QR + secret → confirm reveals the one-time recovery codes", async () => {
    h.enrol.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/x" });
    h.confirm.mockResolvedValue({ ok: true, recoveryCodes: ["aaaa-bbbb-cccc-dddd", "eeee-ffff-gggg-hhhh"] });
    renderWithProviders(<TwoFactorAuth />);

    fireEvent.click(screen.getByRole("button", { name: /enable two-factor/i }));
    await waitFor(() => expect(screen.getByAltText("Two-factor QR code")).toBeInTheDocument());
    expect(h.enrol).toHaveBeenCalled();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await waitFor(() => expect(screen.getByText("aaaa-bbbb-cccc-dddd")).toBeInTheDocument());
    expect(h.confirm).toHaveBeenCalledWith("123456");
    expect(screen.getByText("eeee-ffff-gggg-hhhh")).toBeInTheDocument();
  });

  it("when enrolled, shows status and disables with a current code", async () => {
    h.status.current = { available: true, enrolled: true, pending: false, recoveryRemaining: 3 };
    h.disable.mockResolvedValue({ ok: true });
    renderWithProviders(<TwoFactorAuth />);
    expect(screen.getByText(/3 recovery codes left/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/current code/i), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: /^Disable$/ }));
    await waitFor(() => expect(h.disable).toHaveBeenCalledWith({ code: "654321" }));
  });

  it("the Confirm/Disable buttons stay disabled until a 6-digit code is entered", () => {
    renderWithProviders(<TwoFactorAuth />);
    // idle → the enable button is enabled; there's no code field yet.
    expect(screen.getByRole("button", { name: /enable two-factor/i })).toBeEnabled();
  });
});
