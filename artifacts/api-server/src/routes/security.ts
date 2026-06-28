import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";
import { exportConfigKey, configKeyFingerprint } from "../lib/config-crypto";
import { listKeys, revokeKey, revokeUserSessions, KEY_NAMES, type KeyName } from "../lib/key-registry";

/**
 * Admin-gated key revocation. An admin can retire a signing key (session / provenance /
 * broker) — rolling it to a fresh derived version so anything signed by the revoked
 * version is rejected (sessions) or flagged untrusted (provenance) — or revoke a single
 * user's sessions. Every action is audited. RAM-only state (cleared on restart).
 */
const router = Router();

const isKeyName = (s: string): s is KeyName => (KEY_NAMES as readonly string[]).includes(s);

router.get("/security/keys", requireRole("admin"), (_req, res) => {
  res.json({ keys: listKeys() });
});

router.post("/security/keys/:name/revoke", requireRole("admin"), requireStepUp, (req, res) => {
  const name = String(req.params["name"]);
  if (!isKeyName(name)) { res.status(404).json({ error: "unknown key" }); return; }
  const session = getSession(req);
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason : undefined;
  const status = revokeKey(name, { by: session?.sub ?? null, reason });
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "key.revoke", actor: session ? { sub: session.sub, email: session.email } : null, write: true, meta: { key: name, newVersion: status.version, reason: reason ?? null } });
  res.json({ status });
});

router.post("/security/sessions/revoke-user", requireRole("admin"), requireStepUp, (req, res) => {
  const sub = typeof (req.body as { sub?: unknown })?.sub === "string" ? (req.body as { sub: string }).sub : "";
  if (!sub) { res.status(400).json({ error: "sub is required" }); return; }
  revokeUserSessions(sub);
  const session = getSession(req);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "sessions.revoke-user", actor: session ? { sub: session.sub, email: session.email } : null, write: true, meta: { sub } });
  res.json({ ok: true });
});

// The config-key FINGERPRINT (non-secret) — lets an admin confirm two deployments share
// a key without revealing it. Any admin may read it.
router.get("/security/config-key", requireRole("admin"), (_req, res) => {
  res.json({ fingerprint: configKeyFingerprint() });
});

// EXPORT the raw config encryption key (admin + step-up). Sensitive: this is the secret
// that decrypts the at-rest config files, so an admin can carry encrypted files to another
// deployment and decrypt them there. Returned once, loudly, and audited.
router.post("/security/config-key/export", requireRole("admin"), requireStepUp, (req, res) => {
  const session = getSession(req);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "config-key.export", actor: session ? { sub: session.sub, email: session.email } : null, write: true, result: "success", meta: { fingerprint: configKeyFingerprint() } });
  res.json({
    key: exportConfigKey(),
    fingerprint: configKeyFingerprint(),
    warning: "This is the secret that decrypts your config files. Store it like any key; anyone with it can read exported config. Set it as CONFIG_KEY_RAW (base64) on the target deployment to decrypt moved files.",
  });
});

export default router;
