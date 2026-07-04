import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { usePriorityWeights, useSavePriorityWeights, DEFAULT_PRIORITY_WEIGHTS, type PriorityWeights } from "../../lib/priority-weights-api";
import { useDraftAdmin } from "../../hooks/use-draft-admin";

/**
 * Portfolio prioritisation scoring weights (backlog #98) — the ONLY configurable part of the
 * fund/rank/defer view (Reports → Portfolio Prioritisation & Funding Funnel). PMO-gated, mirroring
 * CustomReportsAdmin: any authed user reads the weights (so the ranking renders identically for
 * everyone); tuning them changes which projects rise to the top, so only the PMO can save.
 */
const DIMENSIONS: { key: keyof PriorityWeights; label: string; hint: string }[] = [
  { key: "rice", label: "RICE", hint: "Reach × Impact × Confidence ÷ Effort" },
  { key: "wsjf", label: "WSJF", hint: "Weighted Shortest Job First" },
  { key: "moscow", label: "MoSCoW", hint: "Must / Should / Could / Won't" },
  { key: "strategic", label: "Strategic", hint: "Strategic-goal contribution %" },
  { key: "benefit", label: "Benefit", hint: "Risk-adjusted benefit value" },
];

export function PriorityWeightsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = usePriorityWeights();
  const save = useSavePriorityWeights();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<PriorityWeights, PriorityWeights>(server, (s) => ({ ...s }));

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft) return null;

  const patch = (key: keyof PriorityWeights, raw: string) => {
    const n = Number(raw);
    setDraft({ ...draft, [key]: Number.isFinite(n) && n >= 0 ? n : 0 });
  };

  return (
    <section className="space-y-4" data-testid="priority-weights-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Portfolio prioritisation</h2>
        <p className="text-xs text-muted-foreground">
          How much each dimension counts toward a project&apos;s rank score on the Portfolio Prioritisation &amp; Funding
          Funnel report. Relative weights — they don&apos;t need to sum to 100; a project not reporting a dimension is
          scored on the ones it does report. The score itself is always computed live, never stored.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        {DIMENSIONS.map((d) => (
          <label key={d.key} className="text-xs flex flex-col gap-1" data-testid={`priority-weight-${d.key}`}>
            <span className="text-muted-foreground uppercase tracking-widest text-[10px]" title={d.hint}>{d.label}</span>
            <Input
              type="number"
              min={0}
              aria-label={`${d.label} weight`}
              className="w-24 rounded-none border-2 border-foreground font-mono"
              value={draft[d.key]}
              onChange={(e) => patch(d.key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save weights"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={reset}>Reset</Button>}
        <Button variant="ghost" className="rounded-none text-xs" onClick={() => setDraft({ ...DEFAULT_PRIORITY_WEIGHTS })}>Restore defaults</Button>
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
