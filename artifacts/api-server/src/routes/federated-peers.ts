import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError, type PeerInstance } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";

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

router.put("/federated-peers", requireRole("admin"), requireStepUp, (req, res) => {
  const raw = (req.body as { peers?: unknown })?.peers;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "peers must be an array" });
    return;
  }
  // A masked "********" (or blank) token in the submitted body means "unchanged" — the admin UI never
  // re-sends a token it can't read back, so preserve the prior one by id rather than overwriting it
  // with the mask literal. A brand-new peer (unknown id) simply needs its own token.
  const existing = new Map(getSettings().federatedPeers.map((p) => [p.id, p] as const));
  const merged = raw.map((p) => {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const prior = typeof o["id"] === "string" ? existing.get(o["id"]) : undefined;
    const submitted = typeof o["token"] === "string" ? o["token"].trim() : "";
    const token = submitted && submitted !== "********" ? submitted : (prior?.token ?? "");
    return { ...o, token };
  });
  try {
    const settings = updateSettings({ federatedPeers: merged });
    captureVersion("federated peers updated");
    res.json({ peers: settings.federatedPeers.map(redact) });
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
