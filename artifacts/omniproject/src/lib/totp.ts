import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { getJson, sendJson } from "./api";

/**
 * App-native TOTP two-factor client — a thin wrapper over the `/api/auth/totp/*` endpoints (enrol → confirm
 * → step-up → disable), the SPA sibling of lib/passkey. The crypto lives server-side in the audited `otpauth`
 * library; here we only drive the flow and render the enrolment QR (the `qrcode` lib turns the server's
 * `otpauth://` URI into a data-URI image — no crypto in the browser).
 */

export interface TotpStatus {
  /** Whether the instance has the 2FA store configured at all. */
  available: boolean;
  /** The user has an ACTIVE authenticator. */
  enrolled: boolean;
  /** A half-finished enrolment awaiting a confirming code. */
  pending: boolean;
  /** Unused recovery codes remaining. */
  recoveryRemaining: number;
}

export const totpStatusKey = ["auth", "totp", "status"] as const;

/** This user's 2FA status. */
export function useTotpStatus() {
  return useQuery({
    queryKey: totpStatusKey,
    queryFn: () => getJson<TotpStatus>("/api/auth/totp/status"),
    staleTime: 5_000,
  });
}

/** Begin enrolment — returns the base32 secret + the `otpauth://` provisioning URI for the QR. */
export function enrolTotp(): Promise<{ secret: string; otpauthUrl: string }> {
  return sendJson<{ secret: string; otpauthUrl: string }>("/api/auth/totp/enrol", {}, "POST", "Could not start two-factor enrolment.");
}

/** Confirm enrolment with a live code — returns the one-time recovery codes (shown once). */
export function confirmTotp(code: string): Promise<{ ok: true; recoveryCodes: string[] }> {
  return sendJson<{ ok: true; recoveryCodes: string[] }>("/api/auth/totp/confirm", { code }, "POST", "That code was not accepted. Check your authenticator and try again.");
}

/** Disable 2FA — requires a current code or a recovery code. */
export function disableTotp(proof: { code?: string; recoveryCode?: string }): Promise<{ ok: true }> {
  return sendJson<{ ok: true }>("/api/auth/totp/disable", proof, "POST", "Could not disable two-factor.");
}

/** Render an `otpauth://` URI to a PNG data-URI for an <img> QR code. */
export function qrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
}
