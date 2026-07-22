import { useState } from "react";
import { Server, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeploymentTypes, useActiveDeployment, useSetDeployment, type DeploymentType } from "../../lib/deployment";

/**
 * "Pick your deployment type" — the first decision on the way in. Choose an archetype (solo self-hoster,
 * small team, cloud, enterprise, regulated), answer its few questions, and the org lands on a known-good
 * setup (storage / auth / broker / methodology / …). Exactly one type is active per org, so this is
 * admin-gated and doubles as the CHANGE control; the broker/backend the type recommends stay re-pickable
 * from their live options. Thin over /api/deployment-types + /api/deployment-type.
 */
export function DeploymentStep({ isAdmin = true }: { isAdmin?: boolean }) {
  const { data } = useDeploymentTypes();
  const { data: active } = useActiveDeployment();
  const setDeployment = useSetDeployment();
  const { toast } = useToast();

  const [picked, setPicked] = useState<DeploymentType | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const types = Array.isArray(data?.deploymentTypes) ? [...data!.deploymentTypes].sort((a, b) => a.order - b.order) : [];
  if (types.length === 0) return null;

  const choose = (t: DeploymentType): void => {
    setPicked(t);
    setAnswers(Object.fromEntries((t.questions ?? []).map((q) => [q.id, q.default])));
  };

  const apply = async (overrides?: Record<string, string>): Promise<void> => {
    if (!isAdmin || !picked) return;
    try {
      await setDeployment.mutateAsync({ deploymentType: picked.id, answers, ...(overrides ? { overrides } : {}) });
      toast({ title: "DEPLOYMENT SET", description: `${picked.label} — your known-good setup is applied. Everything stays editable.` });
    } catch {
      toast({ title: "COULD NOT SET DEPLOYMENT", description: "Check your permissions and try again.", variant: "destructive" });
    }
  };

  // Re-pick a single admin-pickable setting (broker/backend/…) on the ACTIVE deployment.
  const repick = (key: string, value: string): void => {
    if (!active?.deploymentType) return;
    void setDeployment.mutateAsync({ deploymentType: active.deploymentType, answers: active.answers ?? {}, overrides: { ...(active.overrides ?? {}), [key]: value } });
  };

  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-5" data-testid="deployment-step">
      <div className="flex items-center gap-3">
        <Server className="w-4 h-4 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-bold">Pick your deployment type</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose how you're running OmniProject and answer a couple of questions — you'll land on a known-good
        setup for storage, sign-in, broker and way of working. One type is active at a time; you can change it later.
      </p>

      {active?.deploymentType && (
        <div className="mt-4 rounded-lg border border-primary bg-background p-3 text-sm" data-testid="deployment-active">
          <div className="flex items-center gap-2 font-semibold"><Check className="w-4 h-4 text-primary" />Active: {active.deploymentType}</div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {(active.settings ?? []).map((s) => (
              <label key={s.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{s.label}</span>
                {s.pickable && isAdmin ? (
                  <select
                    aria-label={s.label}
                    className="rounded border border-border bg-card px-1.5 py-0.5 text-xs"
                    value={s.value}
                    onChange={(e) => repick(s.key, e.target.value)}
                  >
                    {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <span className="font-mono text-foreground">{s.value}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {types.map((t) => (
          <div key={t.id} className="flex flex-col rounded-lg border border-border bg-background p-3" data-testid={`deployment-card-${t.id}`}>
            <div className="font-semibold">{t.label}</div>
            <p className="mt-2 flex-1 text-xs text-muted-foreground">{t.description}</p>
            <button
              type="button"
              disabled={!isAdmin}
              data-testid={`deployment-pick-${t.id}`}
              onClick={() => choose(t)}
              className={`mt-3 shrink-0 rounded border border-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${!isAdmin ? "opacity-60 cursor-not-allowed" : "hover:bg-primary/10"}`}
            >
              {picked?.id === t.id ? "Selected" : "Choose"}
            </button>
          </div>
        ))}
      </div>

      {picked && (
        <div className="mt-4 rounded-lg border border-border bg-background p-3" data-testid="deployment-questions">
          <div className="text-sm font-semibold">{picked.label} — a few questions</div>
          <div className="mt-2 space-y-2">
            {(picked.questions ?? []).map((q) => (
              <label key={q.id} className="block text-xs">
                <span className="text-muted-foreground">{q.label}</span>
                <select
                  aria-label={q.label}
                  className="mt-0.5 block w-full rounded border border-border bg-card px-2 py-1 text-sm"
                  value={answers[q.id] ?? q.default}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                >
                  {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={!isAdmin || setDeployment.isPending}
            data-testid="deployment-apply"
            onClick={() => void apply()}
            className={`mt-3 rounded border border-primary bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary-foreground ${!isAdmin || setDeployment.isPending ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"}`}
          >
            {setDeployment.isPending ? "Applying…" : "Apply setup"}
          </button>
        </div>
      )}
      {!isAdmin && <p className="mt-3 text-xs text-muted-foreground">Sign in as an admin to set the deployment type.</p>}
    </section>
  );
}
