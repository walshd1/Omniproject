/**
 * `.well-known` endpoints — the machine-readable security.txt (RFC 9116) that
 * publicly invites and directs security researchers. Served OUTSIDE `/api` (and
 * before the SPA history fallback) so scanners find it at the conventional
 * `/.well-known/security.txt` path. The human-readable policy is SECURITY.md.
 */
import { Router } from "express";

/** Where this deployment points researchers (overridable for white-label forks). */
const POLICY_URL = process.env["SECURITY_POLICY_URL"]?.trim()
  || "https://github.com/walshd1/Omniproject/blob/main/SECURITY.md";
const CONTACT_URL = process.env["SECURITY_CONTACT_URL"]?.trim()
  || "https://github.com/walshd1/Omniproject/security/advisories/new";

/** Build the RFC 9116 security.txt body, with a rolling one-year `Expires`. */
export function securityTxt(now: Date = new Date()): string {
  const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return [
    "# OmniProject welcomes independent code audit and penetration testing.",
    "# Test ONLY against an instance you own or operate. Scope, rules of",
    "# engagement and safe-harbour terms are in the policy below.",
    `Contact: ${CONTACT_URL}`,
    `Policy: ${POLICY_URL}`,
    "Preferred-Languages: en",
    `Expires: ${expires}`,
    "",
  ].join("\n");
}

/** Router serving security.txt at the canonical and legacy root paths. */
export const wellKnownRouter: Router = Router();

// Both paths return the same plaintext body (RFC 9116 §3 allows the root path).
wellKnownRouter.get(["/.well-known/security.txt", "/security.txt"], (_req, res) => {
  res.type("text/plain").send(securityTxt());
});
