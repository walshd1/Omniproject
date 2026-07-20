import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useRoleMap, saveRoleMap, rollbackRoleMap, roleMapKey, parseGroups, type RoleMapEntry } from "../../lib/role-map";
import { withStepUp } from "../../lib/step-up";
import { useToast } from "@/hooks/use-toast";

/**
 * Admin group → role mapping editor. Assigns IdP groups/claims to each FIXED OmniProject role (the editable
 * form of the OIDC_*_ROLES env). It cannot invent roles or permissions — the role set is fixed in code — so
 * this only decides which groups confer which role. Admin-only; saves are step-up gated (four-eyes when dual
 * control is configured), durable + fleet-synced. `guest` is invite-only and never claim-mapped, so it's not
 * shown here.
 */

const ROLE_HELP: Record<string, string> = {
  viewer: "Read-only access.",
  contributor: "Create + edit their own work.",
  manager: "Project/programme management (PM).",
  pmo: "Business governance authority (needs strong auth).",
  admin: "Technical/config authority (needs strong auth).",
};

export function RoleMapAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useRoleMap();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.mapping) return null;

  // Only the claim-mappable roles (guest is invite-only).
  const rows = data.mapping.filter((m) => m.role !== "guest");
  const textFor = (m: RoleMapEntry) => edits[m.role] ?? m.claims.join(", ");

  const save = async () => {
    setSaving(true);
    const groupsByRole: Record<string, string[]> = {};
    for (const m of rows) groupsByRole[m.role] = parseGroups(textFor(m));
    const res = await withStepUp(() => saveRoleMap(groupsByRole));
    setSaving(false);
    if (res) { setEdits({}); await qc.invalidateQueries({ queryKey: roleMapKey }); toast({ title: "ROLE MAP SAVED", description: "The group→role mapping was updated." }); }
  };

  const rollback = async () => {
    const res = await withStepUp(() => rollbackRoleMap());
    if (res) { setEdits({}); await qc.invalidateQueries({ queryKey: roleMapKey }); toast({ title: "ROLLED BACK", description: "The previous mapping was restored." }); }
  };

  return (
    <Card data-testid="role-map-admin">
      <CardHeader>
        <CardTitle>Group → role mapping</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Assign your IdP's groups/claims to each OmniProject role. The role set is fixed in code — you decide
          which groups confer which role. Saving requires a re-auth (and a second admin's approval when
          four-eyes is on). <code>guest</code> is invite-only and isn't mapped here.
        </p>
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.role} data-testid={`role-map-row-${m.role}`} className="border border-border p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase tracking-widest text-xs">{m.role}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 text-muted-foreground">{m.source}</span>
                <span className="text-[10px] text-muted-foreground">{ROLE_HELP[m.role]}</span>
              </div>
              <textarea
                data-testid={`role-map-input-${m.role}`}
                value={textFor(m)}
                onChange={(e) => setEdits((p) => ({ ...p, [m.role]: e.target.value }))}
                rows={2}
                placeholder="idp-group-a, idp-group-b"
                className="w-full border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={save} disabled={saving} data-testid="role-map-save">{saving ? "Saving…" : "Save mapping"}</Button>
          {data.rollbackAvailable && <Button type="button" variant="outline" onClick={rollback} data-testid="role-map-rollback">Undo last change</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
