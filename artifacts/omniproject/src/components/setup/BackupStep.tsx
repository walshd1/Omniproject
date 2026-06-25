import { useRef, useState } from "react";
import { Download, Save, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadSnapshot, restoreSnapshot, type SetupStatus } from "../../lib/setup";
import { Step, download, useRefreshAndSettings } from "./shared";
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

  // Stage 1: read + parse + structurally validate the file. Guards JSON.parse so
  // a malformed/wrong file gives a clear message and never reaches the gateway.
  const onSelectFile = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast({ title: "RESTORE FAILED", description: "File is not valid JSON.", variant: "destructive" });
      return;
    }
    const shapeError = validateSnapshot(parsed);
    if (shapeError) {
      toast({ title: "RESTORE FAILED", description: shapeError, variant: "destructive" });
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
        title: "CONFIG RESTORED",
        description: result.warnings?.length ? `${result.warnings.length} warning(s) — check the console.` : "Settings restored from snapshot.",
      });
      if (result.warnings?.length) console.warn("Restore warnings:", result.warnings);
    } catch (e) {
      toast({ title: "RESTORE FAILED", description: e instanceof Error ? e.message : "Invalid snapshot file.", variant: "destructive" });
    }
  };

  return (
    /* Step 6 — backup & restore */
    <Step n={6} title="Backup & restore">
      <p className="text-xs text-muted-foreground">
        Take a JSON snapshot of the gateway config before a risky change or a port — and restore it if setup goes
        wrong. Secrets stay in your environment (use the config export above for those); this captures the runtime
        settings.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => downloadSnapshot().catch(() => toast({ title: "ERROR", description: "Could not download (admin only).", variant: "destructive" }))}
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
    </Step>
  );
}
