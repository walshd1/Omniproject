import { useEffect, useState } from "react";
import { RotateCcw, Star, GitBranch } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchEnvironments,
  createEnvironment,
  activateEnvironment,
  promoteEnvironment,
  markKnownGood,
  rollback,
  type StoreView,
} from "../../lib/setup";
import { Step, useRefreshAndSettings } from "./shared";
import { envNameError } from "../../lib/validation";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/**
 * Wraps a destructive trigger button in an AlertDialog confirmation. The trigger
 * keeps the original button's classes/content; `onConfirm` runs only after the
 * user accepts. RBAC gating stays on the caller (these only render for admins).
 */
function ConfirmButton({
  className,
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  triggerTitle,
}: {
  className: string;
  children: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Tooltip / accessible label for an icon-only trigger button. */
  triggerTitle?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" disabled={disabled} className={className} title={triggerTitle} aria-label={triggerTitle}>
          {children}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-red-500 text-background hover:bg-red-600">
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function EnvironmentsStep({ isAdmin }: { isAdmin: boolean }) {
  const refreshAndSettings = useRefreshAndSettings();
  const { toast } = useToast();

  const [store, setStore] = useState<StoreView | null>(null);
  const [newEnv, setNewEnv] = useState("");
  // Only surface the format error once the user has typed something.
  const newEnvError = newEnv.trim() ? envNameError(newEnv) : null;

  useEffect(() => {
    if (isAdmin) fetchEnvironments().then(setStore).catch(() => setStore(null));
  }, [isAdmin]);

  const envAction = async (label: string, fn: () => Promise<StoreView>): Promise<boolean> => {
    try {
      setStore(await fn());
      refreshAndSettings();
      toast({ title: label });
      return true;
    } catch (e) {
      toast({ title: "Couldn't do that", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
      return false;
    }
  };

  const doRollback = async (body: { versionId?: string; toKnownGood?: boolean }) => {
    try {
      const r = await rollback(body);
      setStore(r.store);
      refreshAndSettings();
      toast({ title: "Rolled back", description: `Restored config version ${r.appliedVersion}.` });
    } catch (e) {
      toast({ title: "Couldn't roll back", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
    }
  };

  return (
    /* Step 7 — environments & rollback */
    <Step n={7} title="Environments & rollback">
      <p className="text-xs text-muted-foreground">
        Not needed on day one. Once you're running for real, this lets you test changes in a
        <b> sandbox</b> without touching your live setup, and undo any change instantly.
      </p>

      {!isAdmin ? (
        <p className="text-xs text-amber-500">Environments & rollback require the admin role.</p>
      ) : !store ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Active:</span>
            {store.environments.map((env) => (
              <button
                key={env}
                onClick={() => env !== store.activeEnv && envAction(`SWITCHED TO ${env.toUpperCase()}`, () => activateEnvironment(env))}
                className={`px-2.5 py-1 text-xs font-black uppercase tracking-widest border ${env === store.activeEnv ? (env === "production" ? "border-red-500/50 text-red-500 bg-red-500/10" : "border-primary text-primary bg-primary/10") : "border-border text-muted-foreground hover:border-primary"}`}
                title={env === store.activeEnv ? "Active environment" : "Switch to this environment"}
              >
                {env}{env === store.activeEnv ? " ●" : ""}
              </button>
            ))}
            <span className="mx-1 text-border">·</span>
            <input
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
              placeholder="sandbox"
              aria-label="New environment name"
              aria-invalid={newEnvError ? true : undefined}
              aria-describedby={newEnvError ? "new-env-error" : undefined}
              className={`w-28 bg-background border px-2 py-1 text-xs font-mono outline-none focus:border-primary ${newEnvError ? "border-red-500" : "border-border"}`}
            />
            <button
              onClick={() => {
                const name = newEnv.trim();
                if (!name || envNameError(newEnv)) return;
                envAction(`CREATED ${name.toUpperCase()}`, () => createEnvironment(name)).then((ok) => {
                  if (ok) setNewEnv("");
                });
              }}
              disabled={!!newEnvError}
              className="px-2.5 py-1 text-xs font-black uppercase tracking-widest border border-border hover:border-primary disabled:opacity-40 disabled:hover:border-border flex items-center gap-1.5"
            >
              <GitBranch className="w-3 h-3" /> New env
            </button>
            {store.environments.includes("sandbox") && store.environments.includes("production") && (
              <ConfirmButton
                className="px-2.5 py-1 text-xs font-black uppercase tracking-widest border border-amber-500/50 text-amber-500 hover:bg-amber-500 hover:text-background"
                title="Promote sandbox to production?"
                description="This copies the current sandbox integration config over production. Live traffic will immediately use the promoted settings. A new version is recorded so you can roll back."
                confirmLabel="Promote to production"
                onConfirm={() => envAction("PROMOTED SANDBOX → PRODUCTION", () => promoteEnvironment("sandbox", "production"))}
              >
                Promote sandbox → prod
              </ConfirmButton>
            )}
          </div>

          {newEnvError && (
            <p id="new-env-error" role="alert" className="text-xs font-bold text-red-500">{newEnvError}</p>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Version history {store.persisted ? "(persisted)" : "(in-memory)"}
            </span>
            <ConfirmButton
              disabled={!store.lastKnownGoodId}
              className="px-3 py-1.5 text-xs font-black uppercase tracking-widest border border-green-500/50 text-green-500 hover:bg-green-500 hover:text-background disabled:opacity-40 flex items-center gap-1.5"
              title="Roll back to last known-good?"
              description="This restores the configuration pinned as known-good, discarding the current active config in favour of it. Live traffic will use the restored settings immediately."
              confirmLabel="Roll back"
              onConfirm={() => doRollback({ toKnownGood: true })}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Roll back to last known-good
            </ConfirmButton>
          </div>

          <div className="border border-border bg-background max-h-64 overflow-y-auto divide-y divide-border">
            {store.versions.slice(0, 20).map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <span className="font-mono text-muted-foreground w-8">{v.id}</span>
                <span className="font-bold uppercase tracking-widest text-[10px] border border-border px-1">{v.env}</span>
                <span className="flex-1 truncate">{v.label ?? "—"}</span>
                <span className="font-mono text-muted-foreground text-[10px]">{new Date(v.at).toLocaleString()}</span>
                <button
                  onClick={() => envAction("PINNED KNOWN-GOOD", () => markKnownGood(v.id))}
                  title="Pin as known-good"
                  className={v.knownGood ? "text-green-500" : "text-muted-foreground/40 hover:text-green-500"}
                >
                  <Star className="w-3.5 h-3.5" fill={v.knownGood ? "currentColor" : "none"} />
                </button>
                <ConfirmButton
                  title="Roll back to this version?"
                  description={<>Restore configuration version <span className="font-mono">{v.id}</span>{v.label ? ` (“${v.label}”)` : ""}, discarding the current active config. Live traffic will use the restored settings immediately.</>}
                  confirmLabel="Roll back"
                  onConfirm={() => doRollback({ versionId: v.id })}
                  triggerTitle="Roll back to this version"
                  className="text-muted-foreground hover:text-primary"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </ConfirmButton>
              </div>
            ))}
          </div>
        </>
      )}
    </Step>
  );
}
