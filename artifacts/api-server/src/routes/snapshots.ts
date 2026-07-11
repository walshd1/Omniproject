import { Router } from "express";
import crypto from "node:crypto";
import { buildSnapshot, verifySnapshot, type SnapshotBundle } from "../lib/snapshot";
import { publicKeyPem, publicKeyId, signingEnabled } from "../lib/signing";
import { recordAudit, actorForAudit } from "../lib/audit";
import { requireRole } from "../lib/rbac";

/**
 * Provably-immutable snapshots. Capture freezes a supplied content set (a report's data / a board pack):
 * the server content-hashes it, signs the manifest with the deployment Ed25519 key, and hands back the
 * bundle for the holder to KEEP. Nothing is stored — zero-at-rest is preserved; the snapshot's provability
 * is self-contained (content hash + signature + the published public key). Verify recomputes the hash and
 * checks the signature, so a snapshot can be shown authentic and unaltered months later.
 */
const router = Router();

const asStr = (v: unknown, fallback = ""): string => (typeof v === "string" && v ? v : fallback);

/** Capture a snapshot of the client-supplied `data`. Server sets the trusted id + time, then signs.
 *  Gated at `contributor`: capture signs arbitrary caller-supplied data with the deployment key, so
 *  a read-only viewer/API-token should not be able to mint "provably-authentic" bundles. */
router.post("/snapshots/capture", requireRole("contributor"), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!("data" in body)) { res.status(400).json({ error: "a `data` payload to snapshot is required" }); return; }
  const bundle = buildSnapshot({
    id: crypto.randomUUID(),
    scope: asStr(body["scope"], "snapshot"),
    label: asStr(body["label"], "Snapshot"),
    createdAt: new Date().toISOString(),
    data: body["data"],
  });
  recordAudit({
    ts: new Date().toISOString(), category: "request", action: "snapshot.capture",
    actor: actorForAudit(req),
    result: "success", status: 200,
    // Only the manifest (hashes/scope/counts) is audited — never the snapshotted content.
    meta: { id: bundle.manifest.id, scope: bundle.manifest.scope, contentHash: bundle.manifest.contentHash, signed: !!bundle.manifest.signature },
  });
  res.json(bundle);
});

/** Verify a bundle (manifest + data) — recompute the hash and check the signature. Stateless. */
router.post("/snapshots/verify", (req, res) => {
  const bundle = req.body as Partial<SnapshotBundle>;
  if (!bundle || typeof bundle !== "object" || !bundle.manifest || !("data" in bundle)) {
    res.status(400).json({ error: "a { manifest, data } bundle is required" }); return;
  }
  res.json(verifySnapshot(bundle as SnapshotBundle));
});

/** The public key a third party uses to verify a signed snapshot offline (no server round-trip). */
router.get("/snapshots/key", (_req, res) => {
  res.json({ signingEnabled: signingEnabled(), publicKeyId: publicKeyId(), publicKeyPem: publicKeyPem() });
});

export default router;
