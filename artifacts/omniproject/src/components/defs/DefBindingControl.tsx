import { useState } from "react";
import { Lock, Check } from "lucide-react";
import { useAuth, roleAtLeast, isPmoOrAdmin } from "../../lib/auth";
import { useResolvedDefs, useActiveDefs, type DefKind } from "../../lib/defs";
import { useSetBinding, type BindingScope } from "../../lib/def-bindings";

/**
 * DEF SELECTION + LOCK control (roadmap X.12 slice 4). For a logical SLOT (a screen id, a methodology slot, …)
 * this shows which def is CURRENTLY in use (the server-resolved winner, with its source + any lock), lets an
 * authorized caller pick a different def, and — at project/programme/org scope — LOCK it so lower scopes can't
 * override ("the org mandates this"). The server stays authoritative: it re-checks the role + scope, and a lock
 * needs a fresh step-up (surfaced here as a 403 the caller must clear). The winner logic is NOT re-derived here.
 */

const SCOPE_LABEL: Record<BindingScope, string> = { user: "Just me", project: "This project", programme: "This programme", org: "Org-wide" };

export interface DefBindingControlProps {
  /** The logical slot this selection governs (e.g. a screen id like "projects"). */
  slot: string;
  /** The def kind whose candidates are offered. */
  kind: DefKind;
  /** Human label for the slot (defaults to the slot id). */
  label?: string;
  projectId?: string;
  programmeId?: string;
}

export function DefBindingControl({ slot, kind, label, projectId, programmeId }: DefBindingControlProps) {
  const { data: auth } = useAuth();
  const role = auth?.role;
  const { data: defs } = useResolvedDefs(kind, projectId, programmeId);
  const { data: active } = useActiveDefs(projectId, programmeId);
  const setBinding = useSetBinding();

  const winner = active?.[slot];
  const candidates = Array.isArray(defs) ? defs.filter((d) => d.kind === kind) : [];

  // The scopes THIS caller may bind at (the server re-checks — this only shapes the UI). `user` is always
  // available; project/programme require the rung AND that a scope id is in context; org needs pmo/admin.
  const scopes: BindingScope[] = ["user"];
  if (roleAtLeast(role, "manager") && projectId) scopes.push("project");
  if (roleAtLeast(role, "programmeManager") && programmeId) scopes.push("programme");
  if (isPmoOrAdmin(role)) scopes.push("org");

  const [scope, setScope] = useState<BindingScope>("user");
  const [defId, setDefId] = useState<string>("");
  const [lock, setLock] = useState(false);
  const canLock = scope !== "user"; // a user selection never locks anyone else

  const save = () => {
    setBinding.mutate({
      scope, slot,
      defId: defId || null, // "" (Default) clears the binding → reverts to the next scope / shipped default
      ...(canLock ? { locked: lock } : {}),
      ...(projectId ? { projectId } : {}),
      ...(programmeId ? { programmeId } : {}),
    });
  };

  const err = setBinding.error as { message?: string } | null;
  const stepUpNeeded = /step-up/i.test(err?.message ?? "");

  return (
    <div className="border border-border bg-card p-3 space-y-2 text-sm" data-testid={`def-binding-${slot}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold uppercase tracking-widest text-xs text-muted-foreground">{label ?? slot}</span>
        <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid={`def-binding-active-${slot}`}>
          {winner?.locked && <Lock className="h-3 w-3" aria-label="locked" />}
          {winner?.defId ? `in use: ${winner.defId} (${winner.source})` : "in use: shipped default"}
          {winner?.locked && winner.lockedBy ? ` · locked by ${winner.lockedBy}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1">
          <span className="block text-muted-foreground">Set for</span>
          <select data-testid={`def-binding-scope-${slot}`} value={scope} onChange={(e) => setScope(e.target.value as BindingScope)}
            className="border border-border bg-background px-2 py-1 text-sm">
            {scopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1 flex-1 min-w-40">
          <span className="block text-muted-foreground">Use def</span>
          <select data-testid={`def-binding-def-${slot}`} value={defId} onChange={(e) => setDefId(e.target.value)}
            className="w-full border border-border bg-background px-2 py-1 text-sm">
            <option value="">Default (shipped)</option>
            {candidates.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.storage})</option>)}
          </select>
        </label>
        {canLock && (
          <label className="text-xs flex items-center gap-1 pb-1.5" title="Lock so lower scopes can't override (needs a fresh step-up)">
            <input type="checkbox" data-testid={`def-binding-lock-${slot}`} checked={lock} onChange={(e) => setLock(e.target.checked)} />
            <Lock className="h-3 w-3" /> Lock
          </label>
        )}
        <button data-testid={`def-binding-save-${slot}`} onClick={save} disabled={setBinding.isPending}
          className="inline-flex items-center gap-1 border-2 border-foreground bg-foreground px-2 py-1 text-xs font-bold text-background disabled:opacity-50">
          <Check className="h-3 w-3" /> Apply
        </button>
      </div>

      {stepUpNeeded && (
        <p className="text-xs text-amber-600" data-testid={`def-binding-stepup-${slot}`}>
          Locking a selection needs a fresh re-authentication (step-up). Verify, then apply again.
        </p>
      )}
      {err && !stepUpNeeded && (
        <p className="text-xs text-red-600" data-testid={`def-binding-error-${slot}`}>That selection was refused — check your permissions and scope.</p>
      )}
    </div>
  );
}
