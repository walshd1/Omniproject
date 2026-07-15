import { Router } from "express";
import { getSettings, SettingsValidationError, type PeerInstance } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { applySettingsGuarded } from "../lib/settings-guard";
import { actorForAudit } from "../lib/audit";

/**
 * Federated-peer registry (backlog #135) — the other OmniProject instances (typically one per
 * region/subsidiary under data residency, docs/DATA-RESIDENCY.md) this deployment fans out to for a
 * consolidated portfolio view (see lib/federation.ts). Each entry is a base URL + a bearer token this
 * instance presents to the peer's OWN existing read-only API-token auth (lib/api-token.ts) — config
 * only (a URL + a credential), never project data, same trust class as an outbound webhook target.
 * Admin-gated, mirroring routes/webhooks; tokens are masked on read.
 *
 *  - GET /api/federated-peers   — list (tokens redacted)
 *  - PUT /api/federated-peers   — replace the whole list (admin)
 */
const router = Router();

function redact(p: PeerInstance) {
  const { token, ...rest } = p;
  return { ...rest, tokenSet: !!token };
}

router.get("/federated-peers", requireRole("admin"), (_req, res) => {
  res.json({ peers: (getSettings().federatedPeers ?? []).map(redact) });
});

router.put("/federated-peers", requireRole("admin"), requireStepUp, async (req, res) => {
  const raw = (req.body as { peers?: unknown })?.peers;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "peers must be an array" });
    return;
  }
  // A masked "********" (or blank) token in the submitted body means "unchanged" — the admin UI never
  // re-sends a token it can't read back, so preserve the prior one by id. CRUCIAL: preserve it ONLY when
  // the peer's endpoint is UNCHANGED. If the baseUrl changed for an existing peer, carrying the masked
  // token forward would transmit the real bearer credential to the NEW host on the next fan-out — a
  // credential-redirect exfil that defeats the token masking. In that case require the token to be
  // re-entered. Fields are whitelisted (no mass-assignment of arbitrary keys into the stored peer).
  const existing = new Map(getSettings().federatedPeers.map((p) => [p.id, p] as const));
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  let redirectError: string | null = null;
  const merged: PeerInstance[] = raw.map((p) => {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const prior = id ? existing.get(id) : undefined;
    const submittedBase = str(o["baseUrl"]);
    const baseUrl = submittedBase || prior?.baseUrl || "";
    const submittedTok = str(o["token"]);
    const masked = !submittedTok || submittedTok === "********";
    const endpointChanged = !!prior && !!submittedBase && submittedBase !== prior.baseUrl;
    if (masked && endpointChanged) {
      redirectError = `peer "${id}": re-enter the token when changing its URL (a masked token cannot be carried to a new endpoint)`;
    }
    const token = !masked ? submittedTok : (prior && !endpointChanged ? prior.token : "");
    return {
      id,
      label: str(o["label"]),
      baseUrl,
      token,
      region: o["region"] === null ? null : (str(o["region"]) || null),
      active: o["active"] === true,
    };
  });
  if (redirectError) {
    res.status(400).json({ error: redirectError });
    return;
  }
  try {
    // Governing invariant (§0): registering a NEW active peer opens a new cross-instance egress target, so
    // it is held for a signed sign-off (the token is sealed in the queue, never plaintext at rest). Removing
    // a peer or a token-preserving edit strengthens/neutral → applies immediately.
    const guarded = await applySettingsGuarded({ federatedPeers: merged }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, message: "Registering a new federated peer opens a new egress target and needs a signed sign-off before it goes live. See /api/approvals/inbox." });
      return;
    }
    captureVersion("federated peers updated");
    res.json({ peers: getSettings().federatedPeers.map(redact) });
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
