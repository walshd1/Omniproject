import nodemailer from "nodemailer";
import { logger } from "./logger";

/**
 * Real SMTP email sending — off unless `SMTP_URL` is set (e.g. `smtps://user:pass@smtp.example.com`),
 * so passwordless sign-in (magic-link) can actually deliver mail for a small org with real SMTP
 * (Google Workspace / Microsoft 365 / any relay) instead of only logging the link.
 *
 * Credentials come from env only (never stored); `nodemailer` has zero runtime dependencies, so it
 * bundles straight into the self-contained esbuild output — no node_modules needed in the runtime
 * image (see build.mjs, which no longer externalizes it).
 *
 * Deliberately NOT loaded via optional-dependency.ts's `loadOptionalDependency` (the pattern the
 * Redis/SAML/geoip clients use): that seam is for packages an operator opts into with their own
 * install (heavier/native deps we don't want in everyone's tree). `nodemailer` is the opposite —
 * zero deps, pure JS, tiny — so it's a committed dependency instead, meaning `SMTP_URL` alone
 * turns this on with no image rebuild required.
 */

/** The minimal shape used from a nodemailer transport, narrowed so tests can inject a fake. */
export interface Mailer {
  sendMail(msg: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Is real SMTP delivery available? True once `SMTP_URL` is set. */
export function isEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env["SMTP_URL"]?.trim();
}

function fromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env["EMAIL_FROM"]?.trim() || "OmniProject <no-reply@localhost>";
}

// Cached across calls in this process — one pooled SMTP connection, not a reconnect per send
// (mirrors the connection-reuse posture of broker-transport.ts's keep-alive agent).
let realMailer: Mailer | undefined;

function defaultMailer(): Mailer {
  const url = process.env["SMTP_URL"]?.trim();
  if (!url) throw new Error("SMTP_URL not configured");
  return (realMailer ??= nodemailer.createTransport(url) as unknown as Mailer);
}

/**
 * Best-effort SMTP send: never throws. Returns false when unconfigured (no `mailer` passed and
 * `SMTP_URL` unset) or on any transport error, so callers can fall back to their own default
 * behaviour (e.g. magic-link's log-only stub) without special-casing failures.
 */
export async function sendEmail(msg: MailMessage, mailer?: Mailer): Promise<boolean> {
  if (!mailer && !isEmailConfigured()) return false;
  try {
    const transport = mailer ?? defaultMailer();
    await transport.sendMail({ from: fromAddress(), to: msg.to, subject: msg.subject, text: msg.text, ...(msg.html !== undefined ? { html: msg.html } : {}) });
    return true;
  } catch (err) {
    logger.warn({ err }, "email: send failed");
    return false;
  }
}
