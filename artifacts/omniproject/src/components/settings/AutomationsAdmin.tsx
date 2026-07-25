import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Workflow } from "lucide-react";
import { AUTOMATION_TRIGGERS, AUTOMATION_ACTIONS, type Predicate, type Op, type AutomationAction, type TriggerKind, type ActionKind } from "@workspace/backend-catalogue";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useAutomations, useSaveAutomations, previewAutomation, runAutomation, type Automation, type AutomationPreview, type AutomationRun } from "../../lib/automations";
import { AdminSection } from "./AdminSection";
import { EditableRowTable } from "./EditableRowTable";
import { safeParseJson } from "../../lib/safe-json";

/**
 * Automations admin — the "when X, do Y" recipe builder. A recipe compiles to the workflow engine; the
 * server enforces that a user may only automate what they may edit (and mutating recipes need an autonomous
 * grant to run). Preview dry-runs the compile and shows the RBAC requirements before you save.
 *
 * Gated to PMO/admin for now (the org-config authoring surface); the per-recipe permission check is enforced
 * server-side regardless of who opens this panel.
 */
// The predicate operator set the builder offers (the shared engine accepts more via raw JSON). Unary ops
// take no value.
const OPS: Op[] = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "truthy", "falsy"];
const UNARY = new Set<Op>(["truthy", "falsy"]);

/** The IF is a ConditionSet; the builder edits its `all` list (every predicate must hold). */
const whenAll = (r: Automation): Predicate[] => r.when?.all ?? [];
/** `in`/`nin` compare against a LIST — author comma-separated, stored as an array; others store the string. */
const parseValue = (op: Op, s: string): unknown => (op === "in" || op === "nin" ? s.split(",").map((x) => x.trim()).filter(Boolean) : s);
const showValue = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));

function uniqueId(base: string, taken: Set<string>): string {
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export function AutomationsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useAutomations();
  const save = useSaveAutomations();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<Automation[], Automation[]>(server);
  const [preview, setPreview] = useState<Record<string, AutomationPreview>>({});
  const [runResult, setRunResult] = useState<Record<string, AutomationRun>>({});

  if (!isPmoOrAdmin(auth?.role)) return null;

  const recipes = draft ?? [];
  const ids = new Set(recipes.map((r) => r.id));
  const setRecipe = (i: number, patch: Partial<Automation>) => setDraft(recipes.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Write the recipe's `when.all` (dropping `when` entirely when the list is empty ⇒ fires unconditionally).
  const setWhen = (i: number, preds: Predicate[]) => setDraft(recipes.map((r, j) => {
    if (j !== i) return r;
    if (!preds.length) { const { when: _drop, ...rest } = r; return rest as Automation; }
    return { ...r, when: { all: preds } };
  }));

  const addRecipe = () => {
    const id = uniqueId("recipe", ids);
    setDraft([...recipes, { id, label: "New automation", scope: { kind: "org" }, trigger: { kind: "issue.created" }, actions: [{ kind: "notify", params: {} }] }]);
  };

  const recipeBad = (r: Automation): string | null => {
    if (!r.id.trim() || !r.label.trim()) return "id and label required";
    if (r.actions.length === 0) return "at least one action";
    if (r.trigger.kind === "schedule" && !r.trigger.cron?.trim()) return "schedule trigger needs a cron expression";
    return null;
  };
  const anyBad = recipes.some((r) => recipeBad(r) !== null) || new Set(recipes.map((r) => r.id)).size !== recipes.length;

  const doPreview = async (r: Automation) => {
    try {
      const p = await previewAutomation(r);
      setPreview((prev) => ({ ...prev, [r.id]: p }));
    } catch (e) {
      toast({ title: "PREVIEW FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  // Test-run a SAVED recipe (unconditionally — an empty test subject; conditions still gate on the server).
  const doTestRun = async (r: Automation) => {
    try {
      const out = await runAutomation(r.id, {});
      setRunResult((prev) => ({ ...prev, [r.id]: out }));
    } catch (e) {
      toast({ title: "RUN FAILED", description: e instanceof Error ? e.message : "Save the recipe first, then run.", variant: "destructive" });
    }
  };

  const onSave = () => save.mutate(recipes, {
    onSuccess: () => toast({ title: "AUTOMATIONS SAVED", description: "Recipes updated." }),
    onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "You may only automate what you can edit.", variant: "destructive" }),
  });

  return (
    <AdminSection icon={Workflow} title="Automations" testId="automations-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">
        “When X, do Y” recipes. Each compiles to the workflow engine and runs with YOUR permissions — you can
        only automate what you may edit. Mutating recipes need an autonomous grant to run; use Preview to check.
      </p>

      <Button type="button" variant="outline" size="sm" onClick={addRecipe} data-testid="automation-add">New automation</Button>
      {recipes.length === 0 && <p className="text-xs text-muted-foreground" data-testid="automations-empty">No automations yet.</p>}

      {recipes.map((r, ri) => {
        const bad = recipeBad(r);
        const p = preview[r.id];
        return (
          <div key={r.id} data-testid={`automation-row-${r.id}`} className={`rounded border p-3 space-y-2 ${bad ? "border-destructive/60" : "border-border"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">{r.id}</span>
              <Input aria-label={`Automation ${ri + 1} label`} value={r.label} onChange={(e) => setRecipe(ri, { label: e.target.value })} className="h-8 max-w-48" placeholder="Label" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(recipes.filter((_, j) => j !== ri))} data-testid={`automation-remove-${r.id}`}>Remove</Button>
            </div>

            {/* Trigger */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold uppercase tracking-widest text-muted-foreground">When</span>
              <select aria-label={`Automation ${ri + 1} trigger`} data-testid={`automation-trigger-${r.id}`} value={r.trigger.kind} onChange={(e) => setRecipe(ri, { trigger: { kind: e.target.value as TriggerKind } })} className="h-8 border border-foreground bg-background px-1">
                {AUTOMATION_TRIGGERS.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
              </select>
              {r.trigger.kind === "schedule" && (
                <Input aria-label={`Automation ${ri + 1} cron`} value={r.trigger.cron ?? ""} onChange={(e) => setRecipe(ri, { trigger: { kind: "schedule", cron: e.target.value } })} className="h-8 max-w-40" placeholder="0 9 * * 1 (cron)" />
              )}
              <span className="font-bold uppercase tracking-widest text-muted-foreground">in</span>
              <select aria-label={`Automation ${ri + 1} scope`} value={r.scope.kind} onChange={(e) => setRecipe(ri, { scope: e.target.value === "project" ? { kind: "project", projectId: "" } : { kind: "org" } })} className="h-8 border border-foreground bg-background px-1">
                <option value="org">the whole org</option>
                <option value="project">a project</option>
              </select>
              {r.scope.kind === "project" && (
                <Input aria-label={`Automation ${ri + 1} project`} value={r.scope.projectId} onChange={(e) => setRecipe(ri, { scope: { kind: "project", projectId: e.target.value } })} className="h-8 max-w-40" placeholder="project id" />
              )}
            </div>

            {/* Conditions — the recipe's `when.all` (every predicate must hold). */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Only if</span>
              <EditableRowTable
                rows={whenAll(r)}
                rowKey={(_, i) => i}
                rowTestId={(_, i) => `automation-${r.id}-cond-${i}`}
                onRemove={(i) => setWhen(ri, whenAll(r).filter((_, j) => j !== i))}
                removeLabel={(i) => `Remove condition ${i + 1}`}
                emptyText="Always."
                columns={[
                  { header: "Field", cell: (c: Predicate, i) => <Input aria-label={`Condition ${i + 1} field`} value={c.field} onChange={(e) => setWhen(ri, whenAll(r).map((x, j) => j === i ? { ...x, field: e.target.value } : x))} className="h-8 max-w-32" /> },
                  { header: "Op", cell: (c: Predicate, i) => <select aria-label={`Condition ${i + 1} op`} value={c.op} onChange={(e) => { const op = e.target.value as Op; setWhen(ri, whenAll(r).map((x, j) => j === i ? { field: x.field, op, ...(UNARY.has(op) ? {} : { value: parseValue(op, showValue(x.value)) }) } : x)); }} className="h-8 border border-foreground bg-background px-1 text-xs">{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select> },
                  { header: "Value", cell: (c: Predicate, i) => UNARY.has(c.op) ? <span className="text-xs text-muted-foreground">—</span> : <Input aria-label={`Condition ${i + 1} value`} value={showValue(c.value)} onChange={(e) => setWhen(ri, whenAll(r).map((x, j) => j === i ? { ...x, value: parseValue(c.op, e.target.value) } : x))} className="h-8 max-w-32" /> },
                ]}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => setWhen(ri, [...whenAll(r), { field: "", op: "eq", value: "" }])} data-testid={`automation-${r.id}-add-cond`}>Add condition</Button>
            </div>

            {/* Actions */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Do</span>
              <EditableRowTable
                rows={r.actions}
                rowKey={(_, i) => i}
                rowTestId={(_, i) => `automation-${r.id}-action-${i}`}
                onRemove={(i) => setRecipe(ri, { actions: r.actions.filter((_, j) => j !== i) })}
                removeLabel={(i) => `Remove action ${i + 1}`}
                emptyText="No actions."
                columns={[
                  { header: "Action", cell: (a: AutomationAction, i) => (
                    <select aria-label={`Action ${i + 1} kind`} value={a.kind} onChange={(e) => setRecipe(ri, { actions: r.actions.map((x, j) => j === i ? { ...x, kind: e.target.value as ActionKind } : x) })} className="h-8 border border-foreground bg-background px-1 text-xs">
                      {AUTOMATION_ACTIONS.map((ad) => <option key={ad.kind} value={ad.kind}>{ad.label}{ad.mutating ? " (needs grant)" : ""}</option>)}
                    </select>
                  ) },
                  { header: "Params (JSON)", cell: (a: AutomationAction, i) => <Input aria-label={`Action ${i + 1} params`} value={JSON.stringify(a.params ?? {})} onChange={(e) => { try { const params = safeParseJson<Record<string, unknown>>(e.target.value || "{}"); setRecipe(ri, { actions: r.actions.map((x, j) => j === i ? { ...x, params } : x) }); } catch { /* keep typing */ } }} className="h-8 max-w-64 font-mono text-[10px]" /> },
                ]}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => setRecipe(ri, { actions: [...r.actions, { kind: "notify", params: {} }] })} data-testid={`automation-${r.id}-add-action`}>Add action</Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void doPreview(r)} data-testid={`automation-preview-${r.id}`}>Preview</Button>
              {p && (
                <span className="text-xs" data-testid={`automation-preview-result-${r.id}`}>
                  {p.canAuthor ? "✓ you can run this" : `✗ ${p.reason ?? "not permitted"}`}
                  {p.mutates && " · mutating (needs an autonomous grant)"}
                </span>
              )}
              {!dirty && (
                <Button type="button" variant="ghost" size="sm" onClick={() => void doTestRun(r)} data-testid={`automation-run-${r.id}`}>Test run</Button>
              )}
              {runResult[r.id] && (
                <span className="text-xs text-muted-foreground" data-testid={`automation-run-result-${r.id}`}>
                  {runResult[r.id]!.ran ? "ran ✓" : runResult[r.id]!.pending === "grant" ? "held — needs a grant" : "no match (conditions not met)"}
                </span>
              )}
            </div>
            {bad && <p className="text-xs text-destructive" data-testid={`automation-bad-${r.id}`}>{bad}</p>}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || anyBad || save.isPending} data-testid="automations-save">{save.isPending ? "SAVING…" : "Save automations"}</Button>
      </div>
    </AdminSection>
  );
}
