import { useRef, useState } from "react";
import { Download, Save, Upload, Database, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadSnapshot, restoreSnapshot, downloadDefsExport, importDefsBundle, downloadFullBackup, restoreFullBackup, type SetupStatus } from "../../lib/setup";
import { Step, download, useRefreshAndSettings } from "./shared";
import { safeParseJson } from "../../lib/safe-json";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const SNAPSHOT_SCHEMA = "omniproject/config-snapshot";
const DEF_STORE_SCHEMA = "omniproject/def-store-export";

const FULL_BACKUP_SCHEMA = "omniproject/full-backup";
const SEALED_BACKUP_SCHEMA = "omniproject/full-backup-sealed";

/** Client-side shape guard for an uploaded def-store export (mirrors the gateway's applyDefStoreExport). */
function validateDefStore(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Backup must be a JSON object.";
  const b = parsed as { schema?: unknown; collections?: unknown };
  if (b.schema !== DEF_STORE_SCHEMA) return `Not an OmniProject def-store backup (expected schema "${DEF_STORE_SCHEMA}").`;
  if (!Array.isArray(b.collections)) return "Backup is missing its collections array.";
  return null;
}

/** Client-side shape guard for an uploaded FULL backup (settings + defs in one file). Accepts BOTH the
 *  plaintext and the sealed (encrypted) envelopes — the gateway decrypts the sealed one under its own key. */
function validateFullBackup(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Backup must be a JSON object.";
  const schema = (parsed as { schema?: unknown }).schema;
  if (schema !== FULL_BACKUP_SCHEMA && schema !== SEALED_BACKUP_SCHEMA) return `Not an OmniProject full backup (expected schema "${FULL_BACKUP_SCHEMA}" or "${SEALED_BACKUP_SCHEMA}").`;
  return null;
}

/**
 * Client-side structural guard for an uploaded snapshot, mirroring the gateway's
 * applySnapshot() expectations. Returns an error string (so we can show a clear
 * message and refuse to apply) or null when the shape is acceptable.
 */
function validateSnapshot(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Snapshot must be a JSON object.";
  }
  const snap = parsed as { schema?: unknown; settings?: unknown };
  if (snap.schema !== SNAPSHOT_SCHEMA) {
    return `Not an OmniProject config snapshot (expected schema "${SNAPSHOT_SCHEMA}").`;
  }
  if (!snap.settings || typeof snap.settings !== "object" || Array.isArray(snap.settings)) {
    return "Snapshot is missing a settings object.";
  }
  return null;
}

export function BackupStep({
  isAdmin,
  status,
}: {
  isAdmin: boolean;
  status: SetupStatus | undefined;
}) {
  const refreshAndSettings = useRefreshAndSettings();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Hold a validated snapshot pending confirmation; restore is destructive
  // (overwrites the live gateway config) so it only runs after the user accepts.
  const [pending, setPending] = useState<{ snapshot: unknown; fileName: string } | null>(null);
  // A validated def-store bundle pending confirmation (reimport re-writes the encrypted def stores).
  const [pendingDefs, setPendingDefs] = useState<{ bundle: unknown; fileName: string } | null>(null);
  const defsInputRef = useRef<HTMLInputElement>(null);
  // A validated FULL backup (settings + defs) pending confirmation.
  const [pendingFull, setPendingFull] = useState<{ backup: unknown; fileName: string } | null>(null);
  const fullInputRef = useRef<HTMLInputElement>(null);

  const stepUpHint = () => toast({
    title: "Re-authentication needed",
    description: "Backing up or restoring the def stores requires a fresh step-up. Re-verify from the security prompt, then try again.",
    variant: "destructive",
  });

  // Stage 1: read + parse + structurally validate the file. Guards JSON.parse so
  // a malformed/wrong file gives a clear message and never reaches the gateway.
  const onSelectFile = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = safeParseJson(await file.text());
    } catch {
      toast({ title: "Couldn't restore", description: "That file isn't valid JSON.", variant: "destructive" });
      return;
    }
    const shapeError = validateSnapshot(parsed);
    if (shapeError) {
      toast({ title: "Couldn't restore", description: shapeError, variant: "destructive" });
      return;
    }
    setPending({ snapshot: parsed, fileName: file.name });
  };

  // Stage 2: apply, only after explicit confirmation.
  const confirmRestore = async () => {
    if (!pending) return;
    const snapshot = pending.snapshot;
    setPending(null);
    try {
      const result = await restoreSnapshot(snapshot);
      refreshAndSettings();
      toast({
        title: "Settings restored",
        description: result.warnings?.length ? `${result.warnings.length} warning(s) — check the console.` : "Settings restored from snapshot.",
      });
      if (result.warnings?.length) console.warn("Restore warnings:", result.warnings);
    } catch (e) {
      toast({ title: "Couldn't restore", description: e instanceof Error ? e.message : "That doesn't look like a valid snapshot file.", variant: "destructive" });
    }
  };

  const onDefsExport = () => {
    downloadDefsExport().catch((e) => {
      if (e instanceof Error && e.message === "step_up_required") stepUpHint();
      else toast({ title: "Couldn't download", description: "You may need admin access.", variant: "destructive" });
    });
  };

  const onSelectDefsFile = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try { parsed = safeParseJson(await file.text()); }
    catch { toast({ title: "Couldn't restore", description: "That file isn't valid JSON.", variant: "destructive" }); return; }
    const shapeError = validateDefStore(parsed);
    if (shapeError) { toast({ title: "Couldn't restore", description: shapeError, variant: "destructive" }); return; }
    setPendingDefs({ bundle: parsed, fileName: file.name });
  };

  const confirmDefsImport = async () => {
    if (!pendingDefs) return;
    const bundle = pendingDefs.bundle;
    setPendingDefs(null);
    try {
      const result = await importDefsBundle(bundle);
      refreshAndSettings();
      const dropped = result.skipped ? ` (${result.skipped} item(s) skipped)` : "";
      toast({ title: "Defs restored", description: `${result.written?.length ?? 0} collection(s) reimported${dropped}.` });
      if (result.warnings?.length) console.warn("Defs import warnings:", result.warnings);
    } catch (e) {
      if (e instanceof Error && e.message === "step_up_required") stepUpHint();
      else toast({ title: "Couldn't restore", description: e instanceof Error ? e.message : "That doesn't look like a valid def-store backup.", variant: "destructive" });
    }
  };

  const onFullExport = (encrypted = false) => {
    downloadFullBackup(encrypted).catch((e) => {
      if (e instanceof Error && e.message === "step_up_required") stepUpHint();
      else toast({ title: "Couldn't download", description: "You may need admin access.", variant: "destructive" });
    });
  };

  const onSelectFullFile = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try { parsed = safeParseJson(await file.text()); }
    catch { toast({ title: "Couldn't restore", description: "That file isn't valid JSON.", variant: "destructive" }); return; }
    const shapeError = validateFullBackup(parsed);
    if (shapeError) { toast({ title: "Couldn't restore", description: shapeError, variant: "destructive" }); return; }
    setPendingFull({ backup: parsed, fileName: file.name });
  };

  const confirmFullRestore = async () => {
    if (!pendingFull) return;
    const backup = pendingFull.backup;
    setPendingFull(null);
    try {
      const result = await restoreFullBackup(backup);
      refreshAndSettings();
      const parts = [result.settingsRestored ? "settings" : null, (result.defStore?.written?.length ?? 0) ? `${result.defStore!.written!.length} def collection(s)` : null].filter(Boolean);
      toast({ title: "Backup restored", description: `Restored ${parts.join(" + ") || "nothing new"}.` });
      if (result.warnings?.length) console.warn("Full-restore warnings:", result.warnings);
    } catch (e) {
      if (e instanceof Error && e.message === "step_up_required") stepUpHint();
      else toast({ title: "Couldn't restore", description: e instanceof Error ? e.message : "That doesn't look like a valid full backup.", variant: "destructive" });
    }
  };

  return (
    /* Step 6 — backup & restore */
    <Step n={6} title="Backup & restore">
      <p className="text-xs text-muted-foreground">
        Not needed on day one — come back to this once you're settled in. It takes a snapshot of
        your settings before a risky change, so you can undo it if something goes wrong.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => downloadSnapshot().catch(() => toast({ title: "Couldn't download", description: "You may need admin access.", variant: "destructive" }))}
          disabled={!isAdmin}
          className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
        >
          <Save className="w-3.5 h-3.5" /> Download backup
        </button>
        <label className={`px-4 py-2 text-xs font-black uppercase tracking-widest border border-border flex items-center gap-2 cursor-pointer hover:border-primary ${!isAdmin ? "opacity-40 pointer-events-none" : ""}`}>
          <Upload className="w-3.5 h-3.5" /> Restore from file
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { onSelectFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </label>
      </div>
      {!isAdmin && <p className="text-xs text-amber-500">Backup & restore require the admin role.</p>}

      {isAdmin && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[11px] uppercase tracking-widest font-bold flex items-center gap-1"><Database className="w-3 h-3" /> Definitions backup</p>
          <p className="text-xs text-muted-foreground">
            Back up everything you've authored into the encrypted stores — imported screens/reports/dashboards and
            other defs, which one is <b>in use</b> at each scope (+ locks), the def-write policy, and custom roles.
            Move it to a new instance or keep it for after an upgrade. The encryption key never leaves; a fresh
            <b> step-up</b> is required, and a reimport re-validates every def before re-encrypting it here.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={onDefsExport}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
            >
              <Save className="w-3.5 h-3.5" /> Download defs backup
            </button>
            <label className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-border flex items-center gap-2 cursor-pointer hover:border-primary">
              <Upload className="w-3.5 h-3.5" /> Restore defs from file
              <input
                ref={defsInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { onSelectDefsFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Our shipped catalogue (system) defs are never exported — they re-seed from the code.</p>
        </div>
      )}

      {isAdmin && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[11px] uppercase tracking-widest font-bold flex items-center gap-1"><Database className="w-3 h-3" /> Full backup (settings + defs)</p>
          <p className="text-xs text-muted-foreground">
            One file with <b>everything</b> — your settings AND your definitions — to move the whole org to a new
            instance or keep after replacing the code. A fresh <b>step-up</b> is required, and restore re-validates
            + re-encrypts under this instance's key.
          </p>
          <p className="text-xs text-muted-foreground">
            <b>Encrypted</b> is the complete state: as well as settings + defs it carries your <b>secrets</b>
            (webhook signing keys, peer tokens, …) and the sensitive stores kept out of clear text — the
            <b> rate card</b> and <b>AI-provider</b> config — all sealed under this deployment's own key
            (API keys stay in the vault). Restoring it on another instance needs the same key material — keep
            the encrypted file <i>and</i> your keys and you have the whole system. The plain
            <b> Download full backup</b> leaves secrets and those sensitive stores out (safe to store as clear text).
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => onFullExport(true)}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
            >
              <ShieldAlert className="w-3.5 h-3.5" /> Download encrypted backup
            </button>
            <button
              onClick={() => onFullExport(false)}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
            >
              <Save className="w-3.5 h-3.5" /> Download full backup
            </button>
            <label className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-border flex items-center gap-2 cursor-pointer hover:border-primary">
              <Upload className="w-3.5 h-3.5" /> Restore full backup
              <input
                ref={fullInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { onSelectFullFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
          </div>
        </div>
      )}

      {isAdmin && status?.dev?.statefulDemo && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[11px] text-amber-500 uppercase tracking-widest font-bold">Stateful developer mode is ON — debugging only</p>
          <p className="text-xs text-muted-foreground">
            Download a <b>debug bundle</b> (config + demo data state) as a .zip for reproducible bug reports and sharing
            to GitHub. Production is stateless; this is not available there.
          </p>
          <button
            onClick={() => download("/api/setup/debug-bundle")}
            className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-amber-500/50 text-amber-500 hover:bg-amber-500 hover:text-background flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" /> Download debug bundle (.zip)
          </button>
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore config from snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites the live gateway configuration (broker URL, AI provider, backend, identity, branding and
              label overrides) with the contents of <span className="font-mono break-all">{pending?.fileName}</span>.
              Current settings will be replaced. Secrets in your environment are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => fileInputRef.current && (fileInputRef.current.value = "")}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore} className="bg-red-500 text-background hover:bg-red-600">Restore config</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDefs} onOpenChange={(o) => { if (!o) setPendingDefs(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore definitions from backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This reimports the encrypted def stores (imported defs, selection bindings + locks, the def-write
              policy and custom roles) from <span className="font-mono break-all">{pendingDefs?.fileName}</span>,
              replacing each scope's current contents. Every def is re-validated and re-encrypted under this
              instance's key. Our shipped system defs are untouched. Needs a fresh step-up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => defsInputRef.current && (defsInputRef.current.value = "")}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDefsImport} className="bg-red-500 text-background hover:bg-red-600">Restore definitions</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingFull} onOpenChange={(o) => { if (!o) setPendingFull(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the FULL backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores <b>both</b> your settings AND your definitions from
              <span className="font-mono break-all"> {pendingFull?.fileName}</span>, replacing the live config and
              re-importing every def store (re-validated + re-encrypted under this instance's key). An
              <b> encrypted</b> backup also restores its sealed secrets (and needs this deployment's key to open);
              a plain backup leaves stored secrets as-is. Environment secrets and shipped system defs are untouched.
              Needs a fresh step-up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => fullInputRef.current && (fullInputRef.current.value = "")}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmFullRestore} className="bg-red-500 text-background hover:bg-red-600">Restore everything</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Step>
  );
}
