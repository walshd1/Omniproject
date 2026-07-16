import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDefPolicy, saveDefPolicy, defPolicyKey, type DefGate, type DefScopePolicy } from "../../lib/def-policy";
import { useToast } from "@/hooks/use-toast";

/**
 * Admin editor for the definition importer's per-scope WRITE policy: who may write a definition to the
 * per-user area, a project, or org-wide. The defaults are user → any contributor, project → a PM (manager),
 * org → PMO or admin; an admin can raise or relax any scope's gate here. Admin-only; behind the `defImporter`
 * module (so the panel shows a hint when that module is off).
 */

const GATE_LABEL: Record<DefGate, string> = {
  contributor: "Any contributor",
  manager: "Manager (PM) or above",
  pmoOrAdmin: "PMO or admin",
  admin: "Admin only",
};
const SCOPE_LABEL: Record<keyof DefScopePolicy, string> = {
  user: "My private area (per-user)",
  project: "Project-wide",
  org: "Org-wide",
};
const SCOPES: (keyof DefScopePolicy)[] = ["user", "project", "org"];

export function DefPolicyAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data, isError } = useDefPolicy();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Partial<DefScopePolicy>>({});
  const [saving, setSaving] = useState(false);

  if (!roleAtLeast(auth?.role, "admin")) return null;

  return (
    <Card data-testid="def-policy-admin">
      <CardHeader><CardTitle>Definition write permissions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Who may write a JSON definition (primitive / screen / form / report / dashboard / business rule /
          theme / font) at each storage scope. Reads stay open to viewers within scope.
        </p>
        {isError && <p className="text-xs text-amber-600" data-testid="def-policy-off">Enable the “JSON definition importer” feature module to configure this.</p>}
        {data && (
          <>
            <div className="space-y-2">
              {SCOPES.map((scope) => {
                const value = edits[scope] ?? data.policy[scope];
                return (
                  <div key={scope} data-testid={`def-policy-row-${scope}`} className="flex items-center justify-between gap-3 border border-border p-3">
                    <span className="text-xs font-semibold">{SCOPE_LABEL[scope]}</span>
                    <select
                      data-testid={`def-policy-${scope}`}
                      value={value}
                      onChange={(e) => setEdits((p) => ({ ...p, [scope]: e.target.value as DefGate }))}
                      className="border border-border bg-background px-2 py-1.5 text-xs"
                    >
                      {data.gates.map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              disabled={saving || Object.keys(edits).length === 0}
              data-testid="def-policy-save"
              onClick={async () => {
                setSaving(true);
                try {
                  await saveDefPolicy(edits);
                  setEdits({});
                  await qc.invalidateQueries({ queryKey: defPolicyKey });
                  toast({ title: "SAVED", description: "Definition write permissions updated." });
                } catch (e) {
                  toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
                } finally { setSaving(false); }
              }}
            >{saving ? "Saving…" : "Save permissions"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
