import { useRef, useState } from "react";
import { captureSnapshot, verifySnapshot, downloadSnapshot, readBundleFile, type SnapshotVerdict } from "../../lib/snapshot";

/**
 * Provably-immutable snapshot affordances for a report.
 *
 * `SnapshotButton` freezes the report's current data: the server content-hashes + signs it and the
 * bundle downloads to KEEP (nothing is stored — zero-at-rest). `SnapshotVerifyPanel` re-checks a
 * previously kept bundle, statelessly, so anyone can prove months later that it is authentic and
 * unaltered. Both surface plainly — no project data is persisted by either side.
 */

const BTN =
  "inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring";

/** Capture + download a signed snapshot of `data`. Disabled when there's nothing to snapshot. */
export function SnapshotButton({ scope, label, data, disabled }: { scope: string; label: string; data: unknown; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function capture() {
    setBusy(true);
    setErr(null);
    try {
      const bundle = await captureSnapshot(scope, label, data);
      downloadSnapshot(bundle);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Snapshot failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={capture} disabled={busy || disabled} className={BTN} data-testid="snapshot-capture">
        {busy ? "Sealing…" : "Snapshot & download"}
      </button>
      {err && <span className="text-[11px] text-red-500" role="alert">{err}</span>}
    </span>
  );
}

function verdictTone(v: SnapshotVerdict): string {
  return v.ok ? "text-green-600" : "text-red-500";
}

/** Upload a kept bundle and prove it intact — recomputes the hash + checks the signature server-side. */
export function SnapshotVerifyPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [verdict, setVerdict] = useState<SnapshotVerdict | null>(null);
  const [meta, setMeta] = useState<{ scope: string; createdAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    setVerdict(null);
    setErr(null);
    setMeta(null);
    if (!file) return;
    try {
      const bundle = await readBundleFile(file);
      setMeta({ scope: bundle.manifest.scope, createdAt: bundle.manifest.createdAt });
      setVerdict(await verifySnapshot(bundle));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not verify that file.");
    }
  }

  return (
    <div className="space-y-2" data-testid="snapshot-verify">
      <button type="button" onClick={() => fileRef.current?.click()} className={BTN}>
        Verify a snapshot…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Snapshot bundle to verify"
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }}
      />
      {err && <p className="text-[11px] text-red-500" role="alert">{err}</p>}
      {verdict && (
        <div className="border border-border p-3 text-xs space-y-1" role="status" data-testid="snapshot-verdict">
          <p className={`font-black uppercase tracking-widest ${verdictTone(verdict)}`}>
            {verdict.ok ? "✓ Authentic & unaltered" : "✗ Verification failed"}
          </p>
          <p className="text-muted-foreground">{verdict.reason}</p>
          <p className="text-muted-foreground">
            Content {verdict.contentMatches ? "matches" : "altered"}
            {" · "}
            Signature {verdict.signatureValid === null ? "not present (integrity only)" : verdict.signatureValid ? "valid" : "invalid"}
            {meta ? ` · ${meta.scope} · ${new Date(meta.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
