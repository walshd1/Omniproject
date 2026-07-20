import { useState } from "react";
import { Target, Plus, Trash2, Link2, CheckCircle2 } from "lucide-react";
import { DataState } from "../components/DataState";
import {
  useGoals, useGoal, useCreateGoal, useCheckInGoal, useLinkGoal, useUnlinkGoal, useDeleteGoal,
  goalStatusTone, GOAL_STATUSES, KEY_RESULT_KINDS, formatKeyResultValue,
  type GoalStatus, type GoalInput, type KeyResult, type KeyResultKind,
} from "../lib/goals";

/**
 * Goals / OKRs (roadmap 3.2). List objectives with derived progress, create a goal with measurable key
 * results + an optional check-in cadence, record progress check-ins (which update the key-result values and
 * roll the cadence forward), and link the work that delivers them. Everything is stored server-side in the
 * sealed storage-target store; this page is the authoring surface. Behind the default-off `goals` module.
 */

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full bg-muted overflow-hidden rounded-sm" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function StatusBadge({ status }: { status: GoalStatus }) {
  return <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${goalStatusTone(status)}`}>{status.replace("_", " ")}</span>;
}

interface DraftKr { label: string; kind: KeyResultKind; target: string; current: string; unit: string }
const newDraftKr = (): DraftKr => ({ label: "", kind: "number", target: "100", current: "0", unit: "" });

function CreateGoalForm({ onDone }: { onDone: () => void }) {
  const create = useCreateGoal();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cadence, setCadence] = useState("");
  const [storage, setStorage] = useState<"user" | "org">("user");
  const [krs, setKrs] = useState<DraftKr[]>([newDraftKr()]);

  const setKr = (i: number, patch: Partial<DraftKr>) => setKrs((prev) => prev.map((k, j) => (j === i ? { ...k, ...patch } : k)));

  const submit = () => {
    const keyResults: GoalInput["keyResults"] = krs
      .filter((k) => k.label.trim())
      .map((k) => ({ label: k.label.trim(), kind: k.kind, target: Number(k.target) || 0, current: Number(k.current) || 0, ...(k.unit.trim() ? { unit: k.unit.trim() } : {}) }));
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), storage, keyResults, ...(description.trim() ? { description: description.trim() } : {}), ...(cadence.trim() ? { cadence: cadence.trim() } : {}) },
      { onSuccess: onDone },
    );
  };

  return (
    <div className="bg-card border border-border p-4 space-y-3" data-testid="goal-create-form">
      <input data-testid="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Objective (e.g. Grow adoption)" className="w-full border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Key results</div>
        {krs.map((k, i) => (
          <div key={i} className="flex gap-1.5">
            <input aria-label={`Key result ${i + 1} label`} value={k.label} onChange={(e) => setKr(i, { label: e.target.value })} placeholder="Measure" className="flex-1 border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
            <select aria-label={`Key result ${i + 1} kind`} value={k.kind} onChange={(e) => setKr(i, { kind: e.target.value as KeyResultKind })} className="border border-border bg-background px-1 py-1 text-xs">
              {KEY_RESULT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
            <input aria-label={`Key result ${i + 1} current`} type="number" value={k.current} onChange={(e) => setKr(i, { current: e.target.value })} className="w-16 border border-border bg-background px-2 py-1 text-xs tabular-nums" />
            <span className="self-center text-xs text-muted-foreground">/</span>
            <input aria-label={`Key result ${i + 1} target`} type="number" value={k.target} onChange={(e) => setKr(i, { target: e.target.value })} className="w-16 border border-border bg-background px-2 py-1 text-xs tabular-nums" />
            <input aria-label={`Key result ${i + 1} unit`} value={k.unit} onChange={(e) => setKr(i, { unit: e.target.value })} placeholder="unit" className="w-14 border border-border bg-background px-2 py-1 text-xs" />
          </div>
        ))}
        <button type="button" onClick={() => setKrs((prev) => [...prev, newDraftKr()])} className="text-xs text-primary hover:underline">+ Add key result</button>
      </div>
      <div className="flex items-center gap-2">
        <input data-testid="goal-cadence" value={cadence} onChange={(e) => setCadence(e.target.value)} placeholder="Check-in cadence (e.g. every 2 weeks)" className="flex-1 border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
        <select aria-label="Storage" value={storage} onChange={(e) => setStorage(e.target.value as "user" | "org")} className="border border-border bg-background px-2 py-1.5 text-xs">
          <option value="user">Private</option>
          <option value="org">Org-wide</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!title.trim() || create.isPending} data-testid="goal-create-submit" className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40">{create.isPending ? "Saving…" : "Create goal"}</button>
        <button type="button" onClick={onDone} className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40">Cancel</button>
      </div>
      {create.isError && <p className="text-xs text-red-600">Couldn't create the goal.</p>}
    </div>
  );
}

function KeyResultCheckIn({ goalId }: { goalId: string }) {
  const { data: goal, isLoading, isError, error, refetch } = useGoal(goalId);
  const checkIn = useCheckInGoal();
  const del = useDeleteGoal();
  const link = useLinkGoal();
  const unlink = useUnlinkGoal();
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<GoalStatus | "">("");
  const [linkRef, setLinkRef] = useState({ system: "", projectRef: "", itemRef: "" });

  const current = (kr: KeyResult) => (values[kr.id] ?? String(kr.current));

  const submitCheckIn = () => {
    if (!goal) return;
    const krValues: Record<string, number> = {};
    for (const kr of goal.keyResults) { const v = values[kr.id]; if (v !== undefined && v !== "" && Number.isFinite(Number(v))) krValues[kr.id] = Number(v); }
    checkIn.mutate(
      { id: goal.id, input: { ...(note.trim() ? { note: note.trim() } : {}), ...(status ? { status } : {}), krValues } },
      { onSuccess: () => { setNote(""); setStatus(""); setValues({}); } },
    );
  };

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {goal && (
        <div className="space-y-4" data-testid="goal-detail">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">{goal.title}</h2>
              {goal.description && <p className="text-sm text-muted-foreground">{goal.description}</p>}
            </div>
            <button type="button" aria-label="Delete goal" onClick={() => del.mutate(goal.id)} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadge status={goal.status} />
            <div className="flex-1"><ProgressBar pct={goal.progressPct} /></div>
            <span className="text-sm font-mono tabular-nums" data-testid="goal-progress">{goal.progressPct}%</span>
          </div>
          {goal.cadence && <p className="text-[11px] text-muted-foreground">Cadence: <strong>{goal.cadence}</strong>{goal.nextCheckInAt ? ` · next check-in ${goal.nextCheckInAt}` : ""}</p>}

          {/* Check-in: edit each key result's current value + a note/status */}
          <div className="border border-border bg-card p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Check in</div>
            {goal.keyResults.map((kr) => (
              <div key={kr.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate" title={kr.label}>{kr.label} <span className="text-[10px] uppercase text-muted-foreground">{kr.kind}</span></span>
                <input aria-label={`Update ${kr.label}`} type="number" value={current(kr)} onChange={(e) => setValues((p) => ({ ...p, [kr.id]: e.target.value }))} className="w-20 border border-border bg-background px-2 py-1 text-xs tabular-nums" />
                <span className="text-xs text-muted-foreground w-20">/ {formatKeyResultValue(kr.kind, kr.target, kr.unit)}</span>
              </div>
            ))}
            {goal.keyResults.length === 0 && <p className="text-xs text-muted-foreground">No key results — add them by editing the goal.</p>}
            <div className="flex gap-2">
              <input data-testid="checkin-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="flex-1 border border-border bg-background px-2 py-1 text-xs" />
              <select aria-label="Set status" value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)} className="border border-border bg-background px-2 py-1 text-xs">
                <option value="">Keep status</option>
                {GOAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
              <button type="button" onClick={submitCheckIn} disabled={checkIn.isPending} data-testid="checkin-submit" className="border border-primary bg-primary text-primary-foreground px-3 py-1 text-xs font-black uppercase tracking-widest disabled:opacity-40 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Check in</button>
            </div>
          </div>

          {/* Linked work */}
          <div className="border border-border bg-card p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />Linked work</div>
            {goal.links.length > 0 ? (
              <ul className="space-y-1">
                {goal.links.map((l) => (
                  <li key={l.key} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{l.label || `${l.system}:${l.projectRef}/${l.itemRef}`}</span>
                    <button type="button" aria-label={`Unlink ${l.itemRef}`} onClick={() => unlink.mutate({ id: goal.id, key: l.key })} className="text-muted-foreground hover:text-red-600">×</button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">No linked work yet.</p>}
            <div className="flex gap-1.5">
              <input aria-label="System" value={linkRef.system} onChange={(e) => setLinkRef((p) => ({ ...p, system: e.target.value }))} placeholder="system" className="w-20 border border-border bg-background px-2 py-1 text-xs" />
              <input aria-label="Project ref" value={linkRef.projectRef} onChange={(e) => setLinkRef((p) => ({ ...p, projectRef: e.target.value }))} placeholder="project" className="w-24 border border-border bg-background px-2 py-1 text-xs" />
              <input aria-label="Item ref" value={linkRef.itemRef} onChange={(e) => setLinkRef((p) => ({ ...p, itemRef: e.target.value }))} placeholder="item" className="flex-1 border border-border bg-background px-2 py-1 text-xs" />
              <button type="button" onClick={() => { if (linkRef.system && linkRef.projectRef && linkRef.itemRef) link.mutate({ id: goal.id, input: linkRef }, { onSuccess: () => setLinkRef({ system: "", projectRef: "", itemRef: "" }) }); }} className="border border-border px-2 py-1 text-xs font-black uppercase hover:bg-muted/40">Link</button>
            </div>
          </div>

          {/* Check-in history */}
          {goal.checkins.length > 0 && (
            <div className="space-y-1" data-testid="goal-history">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">History</div>
              {[...goal.checkins].reverse().map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs border-b border-border/50 py-1">
                  <span className="font-mono tabular-nums text-muted-foreground">{c.at.slice(0, 10)}</span>
                  <span className="font-mono tabular-nums">{c.progressPct}%</span>
                  <StatusBadge status={c.status} />
                  {c.note && <span className="truncate text-muted-foreground">{c.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DataState>
  );
}

export function Goals() {
  const { data: goals, isLoading, isError, error, refetch } = useGoals();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Target className="w-5 h-5" />Goals &amp; OKRs</h1>
        <button type="button" onClick={() => setCreating((c) => !c)} data-testid="goal-new" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest"><Plus className="w-3.5 h-3.5" />New goal</button>
      </div>

      {creating && <CreateGoalForm onDone={() => setCreating(false)} />}

      <div className="grid md:grid-cols-2 gap-4">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
          <div className="space-y-2" data-testid="goal-list">
            {(goals ?? []).length === 0 && !creating && <p className="text-sm text-muted-foreground">No goals yet. Create one to start tracking objectives and key results.</p>}
            {(goals ?? []).map((g) => (
              <button key={g.id} type="button" onClick={() => setSelected(g.id)} data-testid={`goal-row-${g.id}`} className={`w-full text-left border p-3 hover:bg-muted/20 ${selected === g.id ? "border-primary" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold truncate">{g.title}</span>
                  <StatusBadge status={g.status} />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1"><ProgressBar pct={g.progressPct} /></div>
                  <span className="text-xs font-mono tabular-nums">{g.progressPct}%</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">{g.keyResultCount} KR · {g.checkInCount} check-ins{g.nextCheckInAt ? ` · next ${g.nextCheckInAt}` : ""}</div>
              </button>
            ))}
          </div>
        </DataState>

        <div>{selected ? <KeyResultCheckIn goalId={selected} /> : <p className="text-sm text-muted-foreground">Select a goal to check in, link work, or see its history.</p>}</div>
      </div>
    </div>
  );
}
