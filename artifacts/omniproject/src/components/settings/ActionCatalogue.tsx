import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useActionCatalogue, setActionApproved, type CatalogueAction } from "../../lib/actions";
import { stepUp } from "../../lib/step-up";

/**
 * AI action catalogue (admin). The full set of canonical actions an AI tool COULD use,
 * each toggled approved/blocked. The catalogue is the ceiling — approving makes an action
 * possible; the in-app gates (per-surface governance, RBAC, write-grants) narrow further.
 * Writes are flagged; they're blocked by default until an admin approves them.
 */
export function ActionCatalogue() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useActionCatalogue();

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.actions) return null;

  const onToggle = async (a: CatalogueAction): Promise<void> => {
    if (a.write && !a.approved && !window.confirm(`Approve the WRITE action "${a.action}"? AI tools will be able to propose it (still gated by role + write-grants).`)) return;
    if (!(await stepUp())) return; // approving/widening what AI may do is step-up gated
    try { await setActionApproved(a.action, !a.approved); await qc.invalidateQueries({ queryKey: ["action-catalogue"] }); await qc.invalidateQueries({ queryKey: ["autonomous-grants"] }); }
    catch { /* quiet; the toggle simply won't flip */ }
  };

  const reads = data.actions.filter((a) => !a.write);
  const writes = data.actions.filter((a) => a.write);

  const Row = (a: CatalogueAction) => (
    <li key={a.action} className="flex items-start justify-between gap-3 rounded border border-border p-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{a.action}</span>
          {a.write && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">write</span>}
        </div>
        <p className="text-xs text-muted-foreground">{a.description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={a.approved}
        data-testid={`approve-${a.action}`}
        onClick={() => void onToggle(a)}
        className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${a.approved ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
      >
        {a.approved ? "approved" : "blocked"}
      </button>
    </li>
  );

  return (
    <Card data-testid="action-catalogue">
      <CardHeader><CardTitle>AI action catalogue</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every action an AI tool could use. Toggle what’s <strong>approved</strong> — the
          ceiling. Reads are approved by default; <strong>writes start blocked</strong>.
          Approving makes an action possible; per-surface, role and write-grant rules still apply.
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
