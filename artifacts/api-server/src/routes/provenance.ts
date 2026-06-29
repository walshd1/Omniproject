import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { recentProvenance, verifyChain, verifyContent, provenanceAnchor } from "../lib/provenance";

/**
 * Provenance verification (admin) — read + verify the broker-call chain. The chain holds
 * only fingerprints (no content), so these endpoints prove ORDER and NON-ALTERATION; to
 * prove "this exact content", re-present it to the verify endpoint and we recompute the
 * MAC (we never stored the content to hand back).
 */
const router = Router();

// The recent chain (content-free) plus a live integrity verdict.
router.get("/provenance", requireRole("admin"), (_req, res) => {
  const entries = recentProvenance();
  res.json({ entries, chain: verifyChain(entries) });
});

// The chain anchor (tip seq + MAC + key version, plus an Ed25519 signature when signing is
// configured) — the gateway non-repudiably attesting to the provenance tip. Admin; no secrets.
router.get("/provenance/anchor", requireRole("admin"), (_req, res) => {
  res.json(provenanceAnchor());
});

// One call's hops (invoke / result / error), with the running chain still verified.
router.get("/provenance/call/:callId", requireRole("admin"), (req, res) => {
  const entries = recentProvenance(String(req.params["callId"]));
  if (entries.length === 0) { res.status(404).json({ error: "no provenance for that call" }); return; }
  res.json({ entries });
});

// Prove "nothing changed": re-present the content for a hop and confirm the fingerprint.
router.post("/provenance/call/:callId/verify", requireRole("admin"), (req, res) => {
  const callId = String(req.params["callId"]);
  const body = (req.body ?? {}) as { hop?: string; content?: unknown };
  const entry = recentProvenance(callId).find((e) => e.hop === body.hop);
  if (!entry) { res.status(404).json({ error: "no such hop for that call" }); return; }
  res.json({ matches: verifyContent(entry, body.content), seq: entry.seq, contentMac: entry.contentMac });
});

export default router;
