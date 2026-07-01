import { sendJson } from "./api";
import { safeParseJson } from "./safe-json";

/**
 * Provably-immutable snapshots (client). Capture freezes a report's data: the server content-hashes it,
 * signs the manifest, and hands the bundle back for the holder to KEEP — nothing is stored (zero-at-rest).
 * Verify re-checks an offered bundle statelessly. A snapshot can later be shown authentic and unaltered.
 */

export interface SnapshotManifest {
  id: string;
  scope: string;
  label: string;
  createdAt: string;
  rowCount: number;
  contentHash: string;
  hashAlgorithm: "sha256";
  signatureAlgorithm?: "Ed25519";
  signature?: string;
  publicKeyId?: string;
}

export interface SnapshotBundle {
  manifest: SnapshotManifest;
  data: unknown;
}

export interface SnapshotVerdict {
  ok: boolean;
  contentMatches: boolean;
  signatureValid: boolean | null;
  reason: string;
}

/** Capture a snapshot of `data`. The server stamps the trusted id + time, hashes and signs it. */
export function captureSnapshot(scope: string, label: string, data: unknown): Promise<SnapshotBundle> {
  return sendJson<SnapshotBundle>("/api/snapshots/capture", { scope, label, data }, "POST");
}

/** Verify an offered bundle (manifest + data) — recompute the hash, check the signature. Stateless. */
export function verifySnapshot(bundle: SnapshotBundle): Promise<SnapshotVerdict> {
  return sendJson<SnapshotVerdict>("/api/snapshots/verify", bundle, "POST");
}

/** Trigger a browser download of the kept bundle as pretty JSON, named by scope + capture date. */
export function downloadSnapshot(bundle: SnapshotBundle): void {
  const stamp = bundle.manifest.createdAt.slice(0, 10);
  const safe = bundle.manifest.scope.replace(/[^a-z0-9]+/gi, "-");
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `snapshot-${safe}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse an uploaded file as a snapshot bundle, throwing a friendly error if it isn't one. */
export async function readBundleFile(file: File): Promise<SnapshotBundle> {
  let parsed: unknown;
  try {
    parsed = safeParseJson(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const b = parsed as Partial<SnapshotBundle>;
  if (!b || typeof b !== "object" || !b.manifest || !("data" in b) || !b.manifest.contentHash) {
    throw new Error("That JSON isn't a snapshot bundle (no { manifest, data }).");
  }
  return b as SnapshotBundle;
}
