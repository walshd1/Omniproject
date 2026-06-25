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

export function EnvironmentsStep({ isAdmin }: { isAdmin: boolean }) {
  const refreshAndSettings = useRefreshAndSettings();
  const { toast } = useToast();

  const [store, setStore] = useState<StoreView | null>(null);
  const [newEnv, setNewEnv] = useState("");

  useEffect(() => {
    if (isAdmin) fetchEnvironments().then(setStore).catch(() => setStore(null));
  }, [isAdmin]);

  const envAction = async (label: string, fn: () => Promise<StoreView>) => {
    try {
      setStore(await fn());
      refreshAndSettings();
      toast({ title: label });
    } catch (e) {
      toast({ title: "ERROR", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
    }
  };

  const doRollback = async (body: { versionId?: string; toKnownGood?: boolean }) => {
    try {
      const r = await rollback(body);
      setStore(r.store);
      refreshAndSettings();
      toast({ title: "ROLLED BACK", description: `Restored config version ${r.appliedVersion}.` });
    } catch (e) {
      toast({ title: "ROLLBACK FAILED", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
    }
  };

  return (
    /* Step 7 — environments & rollback */
    <Step n={7} title="Environments & rollback">
      <p className="text-xs text-muted-foreground">
        Design and test integration config in a <b>sandbox</b> without touching production, then promote it. Every
        change is versioned — pin a <b>known-good</b> state and roll back instantly if production fails.
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
              className="w-28 bg-background border border-border px-2 py-1 text-xs font-mono outline-none focus:border-primary"
            />
            <button
              onClick={() => newEnv.trim() && envAction(`CREATED ${newEnv.toUpperCase()}`, () => createEnvironment(newEnv.trim())).then(() => setNewEnv(""))}
              className="px-2.5 py-1 text-xs font-black uppercase tracking-widest border border-border hover:border-primary flex items-center gap-1.5"
            >
              <GitBranch className="w-3 h-3" /> New env
            </button>
            {store.environments.includes("sandbox") && store.environments.includes("production") && (
              <button
                onClick={() => envAction("PROMOTED SANDBOX → PRODUCTION", () => promoteEnvironment("sandbox", "production"))}
                className="px-2.5 py-1 text-xs font-black uppercase tracking-widest border border-amber-500/50 text-amber-500 hover:bg-amber-500 hover:text-background"
              >
                Promote sandbox → prod
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Version history {store.persisted ? "(persisted)" : "(in-memory)"}
            </span>
            <button
              onClick={() => doRollback({ toKnownGood: true })}
              disabled={!store.lastKnownGoodId}
              className="px-3 py-1.5 text-xs font-black uppercase tracking-widest border border-green-500/50 text-green-500 hover:bg-green-500 hover:text-background disabled:opacity-40 flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Roll back to last known-good
            </button>
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
                <button
                  onClick={() => doRollback({ versionId: v.id })}
                  title="Roll back to this version"
                  className="text-muted-foreground hover:text-primary"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Step>
  );
}
