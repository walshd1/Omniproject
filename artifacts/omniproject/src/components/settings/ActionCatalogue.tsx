import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useActionCatalogue, setActionApproved, setActionScope, type CatalogueAction, type ActionScope } from "../../lib/actions";
import { stepUp } from "../../lib/step-up";

/**
 * AI action catalogue (admin). The full set of canonical actions an AI tool COULD use,
 * each toggled approved/blocked and optionally SCOPED to surfaces / a minimum role /
 * backends (the full matrix). The catalogue is the ceiling — approving makes an action
 * possible; the in-app gates (per-surface governance, RBAC, write-grants) narrow further.
 * Writes are flagged; they're blocked by default until an admin approves them.
 */
const SCOPE_ROLES = ["viewer", "contributor", "manager", "admin"] as const;

/** A short human summary of a scope, e.g. "projects · ≥manager · jira". "" = global. */
function scopeSummary(s: ActionScope | undefined): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.surfaces?.length) parts.push(s.surfaces.join("/"));
  if (s.minRole) parts.push(`≥${s.minRole}`);
  if (s.backends?.length) parts.push(s.backends.join("/"));
  return parts.join(" · ");
}

export function ActionCatalogue() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useActionCatalogue();
  const [editing, setEditing] = useState<string | null>(null);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.actions) return null;
  const surfaces = data.surfaces ?? [];

  const refresh = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: ["action-catalogue"] });
    await qc.invalidateQueries({ queryKey: ["autonomous-grants"] });
  };

  const onToggle = async (a: CatalogueAction): Promise<void> => {
    if (a.write && !a.approved && !window.confirm(`Approve the WRITE action "${a.action}"? AI tools will be able to propose it (still gated by role + write-grants).`)) return;
    if (!(await stepUp())) return; // approving/widening what AI may do is step-up gated
    try { await setActionApproved(a.action, !a.approved); await refresh(); }
    catch { /* quiet; the toggle simply won't flip */ }
  };

  const onSaveScope = async (action: string, scope: ActionScope): Promise<void> => {
    if (!(await stepUp())) return; // narrowing/widening scope is a sensitive change
    try { await setActionScope(action, scope); setEditing(null); await refresh(); }
    catch { /* quiet */ }
  };

  const Row = (a: CatalogueAction) => {
    const summary = scopeSummary(a.scope);
    return (
      <li key={a.action} className="rounded border border-border p-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium">{a.action}</span>
              {a.write && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">write</span>}
              {a.approved && summary && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800" data-testid={`scope-summary-${a.action}`}>scoped: {summary}</span>}
            </div>
            <p className="text-xs text-muted-foreground">{a.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {a.approved && (
              <button type="button" data-testid={`scope-${a.action}`} onClick={() => setEditing(editing === a.action ? null : a.action)} className="rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground underline">
                scope
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={a.approved}
              data-testid={`approve-${a.action}`}
              onClick={() => void onToggle(a)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${a.approved ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
            >
              {a.approved ? "approved" : "blocked"}
            </button>
          </div>
        </div>
        {a.approved && editing === a.action && (
          <ScopeEditor action={a.action} initial={a.scope ?? {}} surfaces={surfaces} onSave={onSaveScope} onCancel={() => setEditing(null)} />
        )}
      </li>
    );
  };

  const reads = data.actions.filter((a) => !a.write);
  const writes = data.actions.filter((a) => a.write);

  return (
    <Card data-testid="action-catalogue">
      <CardHeader><CardTitle>AI action catalogue</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every action an AI tool could use. Toggle what’s <strong>approved</strong> — the
          ceiling. Reads are approved by default; <strong>writes start blocked</strong>.
          Use <strong>scope</strong> to pin an action to specific screens, a minimum role,
          and/or backends; an unscoped approval applies everywhere.
        </p>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reads</h3>
          <ul className="space-y-1">{reads.map(Row)}</ul>
        </div>
        {writes.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Writes (gated)</h3>
            <ul className="space-y-1">{writes.map(Row)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Inline editor for one action's per-surface/role/backend scope. */
function ScopeEditor({ action, initial, surfaces, onSave, onCancel }: {
  action: string;
  initial: ActionScope;
  surfaces: string[];
  onSave: (action: string, scope: ActionScope) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial.surfaces ?? []);
  const [minRole, setMinRole] = useState<string>(initial.minRole ?? "");
  const [backends, setBackends] = useState<string>((initial.backends ?? []).join(", "));

  const toggleSurface = (id: string): void =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  const save = (): void => {
    const scope: ActionScope = {};
    if (picked.length) scope.surfaces = picked;
    if (minRole) scope.minRole = minRole;
    const be = backends.split(",").map((b) => b.trim()).filter(Boolean);
    if (be.length) scope.backends = be;
    void onSave(action, scope);
  };

  return (
    <div className="mt-2 space-y-2 rounded border border-dashed border-border p-2" data-testid={`scope-editor-${action}`}>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Surfaces (none = all)</p>
        <div className="flex flex-wrap gap-1">
          {surfaces.length === 0 && <span className="text-xs text-muted-foreground">No surfaces available.</span>}
          {surfaces.map((id) => (
            <button key={id} type="button" onClick={() => toggleSurface(id)} data-testid={`scope-surface-${action}-${id}`}
              className={`rounded px-1.5 py-0.5 text-[11px] ${picked.includes(id) ? "bg-sky-100 text-sky-800" : "bg-muted text-muted-foreground"}`}>
              {id}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor={`scope-minrole-${action}`}>Min role</label>
        <select id={`scope-minrole-${action}`} value={minRole} onChange={(e) => setMinRole(e.target.value)} data-testid={`scope-minrole-${action}`} className="h-7 rounded border border-border bg-transparent px-1 text-xs">
          <option value="">(any)</option>
          {SCOPE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor={`scope-backends-${action}`}>Backends</label>
        <input id={`scope-backends-${action}`} value={backends} onChange={(e) => setBackends(e.target.value)} placeholder="e.g. jira, servicenow (none = all)" data-testid={`scope-backends-${action}`}
          className="h-7 flex-1 rounded border border-border bg-transparent px-2 text-xs" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} data-testid={`scope-save-${action}`} className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Save scope</button>
        <button type="button" onClick={onCancel} className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Cancel</button>
      </div>
    </div>
  );
}
