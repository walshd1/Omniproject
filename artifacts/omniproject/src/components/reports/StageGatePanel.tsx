import { canPassGate, gateProgress, type Approval, type GateState, type GateVerdict, type Lifecycle } from "../../lib/stage-gate";

/**
 * Stage-gate panel — a project's position in the phase-gate lifecycle: the gate ladder (passed /
 * current / upcoming), the current gate's criteria + approvals, and the go/kill/hold controls, gated
 * on whether the gate can actually pass. Presentational + controlled; the decision is emitted, the
 * state is the caller's (brokered). See lib/stage-gate.
 */
const VERDICT_STYLE: Record<GateVerdict, string> = {
  go: "border-green-600 bg-green-600 text-white",
  hold: "border-amber-500 text-amber-600",
  kill: "border-red-500 text-red-500",
};

export function StageGatePanel({
  lifecycle,
  state,
  metCriterionIds = [],
  approvals = [],
  onDecide,
}: {
  lifecycle: Lifecycle;
  state: GateState;
  metCriterionIds?: string[];
  approvals?: Approval[];
  onDecide?: (verdict: GateVerdict) => void;
}) {
  const progress = gateProgress(state, lifecycle);
  const gate = progress.currentGate;
  const met = new Set(metCriterionIds);
  const canGo = gate ? canPassGate(gate, metCriterionIds, approvals) : false;

  return (
    <section className="space-y-3 border border-border" data-testid="stage-gate-panel">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
        <span className="font-bold text-sm">Stage-gate lifecycle</span>
        <span className="text-xs uppercase tracking-widest font-black" data-testid="stage-gate-status">
          {progress.status === "in-progress" ? `Gate ${progress.passed + 1} of ${progress.total}` : progress.status}
        </span>
      </div>

      <ol className="flex flex-wrap gap-1.5 px-3" data-testid="stage-gate-ladder">
        {lifecycle.map((g, i) => {
          const stateCls = i < state.currentGateIndex ? "border-green-600 text-green-600"
            : i === state.currentGateIndex && progress.status === "in-progress" ? "border-primary bg-primary/10 font-bold"
            : "border-border text-muted-foreground";
          return (
            <li key={g.id} className={`text-[11px] border px-2 py-0.5 ${stateCls}`} data-testid={`gate-chip-${g.id}`}>
              {i < state.currentGateIndex ? "✓ " : ""}{g.name}
            </li>
          );
        })}
      </ol>

      {gate && (
        <div className="px-3 space-y-2">
          <p className="text-xs font-bold">{gate.name} — entry criteria</p>
          <ul className="space-y-0.5">
            {gate.criteria.map((c) => (
              <li key={c.id} className="text-xs flex items-center gap-2" data-testid={`gate-criterion-${c.id}`}>
                <span className={met.has(c.id) ? "text-green-600" : "text-muted-foreground"}>{met.has(c.id) ? "✓" : "○"}</span>
                {c.label}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Approvals: {approvals.filter((a) => a.verdict === "go").length} / {gate.minApprovals ?? 1} required
          </p>
          <div className="flex gap-2 pb-3">
            {(["go", "hold", "kill"] as GateVerdict[]).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`gate-decide-${v}`}
                disabled={v === "go" && !canGo}
                onClick={() => onDecide?.(v)}
                className={`border px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring ${VERDICT_STYLE[v]}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
