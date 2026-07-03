import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { withStepUp } from "../../lib/step-up";
import {
  fetchConfigDirStatus,
  refreshConfigDir,
  clearConfigDirBackup,
  type ConfigDirStatus,
} from "../../lib/setup";

/**
 * Deployment config directory (OMNI_CONFIG_DIR) status + hot-reload control.
 *
 * The operator edits the folder of JSON directly (their own file system / git / mounted
 * volume — outside this app); "Quick update" is how they tell the gateway to pick that
 * edit up NOW instead of waiting for a restart. The server backs the directory up to
 * `.old` first and auto-reverts if the new content fails to load, so a bad hand-edit
 * can never leave the gateway half-applied — this panel just reports which of those
 * happened. Once the backup is 30+ days old it nudges the admin to clear it out.
 */
export function ConfigDirPanel({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ConfigDirStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => fetchConfigDirStatus().then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin]);

  if (!isAdmin) return null;

  const onQuickUpdate = async () => {
    setBusy(true);
    try {
      await withStepUp(async () => {
        const result = await refreshConfigDir();
        await refresh();
        if (result.reverted) {
          toast({
            title: "Update failed — reverted",
            description: `The new config didn't load cleanly, so the last-known-good backup was restored. ${result.summary.errors[0] ?? ""}`,
            variant: "destructive",
          });
        } else if (result.ok) {
          toast({ title: "Config updated", description: "The directory was reloaded and a fresh backup was saved." });
        } else {
          toast({ title: "Update failed", description: result.summary.errors[0] ?? "No prior backup existed to revert to.", variant: "destructive" });
        }
      });
    } finally {
      setBusy(false);
    }
  };

  const onClearBackup = async () => {
    const { cleared } = await clearConfigDirBackup();
    await refresh();
    toast({ title: cleared ? "Backup cleared" : "Nothing to clear" });
  };

  if (!status) return null;

  // Defensive against a partial/unexpected response shape (a stale/misconfigured API
  // mock in a test, or a future server field change) — degrade to "not configured"
  // rather than crash the surrounding admin screen over an optional status panel.
  const present = status.present === true;
  const vendorTotal = Object.values(status.vendors ?? {}).reduce((sum, n) => sum + n, 0);
  const errors = status.errors ?? [];
  const warnings = status.warnings ?? [];
  const backup = status.backup ?? { present: false, ageDays: null, stale: false };

  return (
    <div className="border border-border p-3 space-y-2" data-testid="config-dir-panel">
      <p className="text-xs font-bold uppercase tracking-widest">Deployment config directory</p>
      {!present ? (
        <p className="text-xs text-muted-foreground">
          No <code>OMNI_CONFIG_DIR</code> configured — vendor overlay files are picked up once you set it.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            <code>{status.dir}</code> — {vendorTotal} vendor override(s), config {status.configApplied ? "applied" : "not applied"}, rulesets{" "}
            {status.rulesetsApplied ? "applied" : "not applied"}.
          </p>
          {errors.length > 0 && (
            <ul className="text-xs text-red-700 list-disc pl-4" data-testid="config-dir-errors">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="text-xs text-amber-700 list-disc pl-4" data-testid="config-dir-warnings">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider text-xs"
          disabled={busy || !present}
          onClick={() => void onQuickUpdate()}
        >
          Quick update
        </Button>
        <span className="text-xs text-muted-foreground">Reload now instead of restarting the gateway.</span>
      </div>
      {backup.present && (
        <div
          className={`flex flex-wrap items-center gap-2 border p-2 ${backup.stale ? "border-amber-400 bg-amber-50" : "border-border"}`}
          data-testid="config-dir-backup-nudge"
        >
          <span className="text-xs">
            Backup (<code>.old</code>) is {Math.floor(backup.ageDays ?? 0)} day(s) old.
            {backup.stale && " Consider clearing it out."}
          </span>
          <Button size="sm" variant="outline" className="h-6 rounded-none px-2 text-xs" onClick={() => void onClearBackup()}>
            Clear backup
          </Button>
        </div>
      )}
    </div>
  );
}
