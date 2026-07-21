import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useCustomRoles, saveCustomRoles, customRolesKey, type CustomRolesConfig, type CustomRolesState } from "../../lib/custom-roles";
import { withStepUp } from "../../lib/step-up";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus } from "lucide-react";

/**
 * Admin editor for CUSTOM ROLES + PERMISSION SETS. An admin names permission bundles (sets of governance
 * capabilities) and custom roles (each grounded in a fixed base role — the hard ceiling — plus permission sets
 * and the IdP groups that confer it). A custom role can never exceed its base role. Admin-only; the save is
 * step-up gated. Server validation is authoritative (referential integrity, no built-in collisions).
 */

const splitGroups = (text: string): string[] => {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) { const g = raw.trim().toLowerCase(); if (g && !out.includes(g)) out.push(g); }
  return out;
};

export function CustomRolesAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useCustomRoles();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<CustomRolesConfig | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the editable copy from the server config the first time it loads.
  useEffect(() => { if (data?.config && !cfg) setCfg(structuredClone(data.config)); }, [data, cfg]);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  const state: CustomRolesState | undefined = data;
  if (!state || !cfg) return null;

  const update = (next: CustomRolesConfig) => setCfg({ ...next });

  const save = async () => {
    setSaving(true);
    const res = await withStepUp(() => saveCustomRoles(cfg));
    setSaving(false);
    if (res) { await qc.invalidateQueries({ queryKey: customRolesKey }); toast({ title: "SAVED", description: "Custom roles & permission sets updated." }); }
    else toast({ title: "Not saved", description: "Re-auth was declined, or the config was rejected — check ids, base roles and references.", variant: "destructive" });
  };

  return (
    <Card data-testid="custom-roles-admin">
      <CardHeader><CardTitle>Custom roles & permission sets</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Name your own roles and permission bundles. A custom role is always grounded in a fixed base role (its
          hard ceiling) — it can never grant more than that base. Assign the IdP groups that confer each role.
        </p>

        {/* Permission sets */}
        <section className="space-y-2" data-testid="permission-sets">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest">Permission sets</h3>
            <Button type="button" variant="outline" size="sm" data-testid="add-permission-set" onClick={() => update({ ...cfg, permissionSets: [...cfg.permissionSets, { id: "", label: "", capabilities: [] }] })}><Plus className="w-3.5 h-3.5" />Add set</Button>
          </div>
          {cfg.permissionSets.length === 0 && <p className="text-xs text-muted-foreground">No permission sets yet.</p>}
          {cfg.permissionSets.map((ps, i) => (
            <div key={i} data-testid={`permission-set-${i}`} className="border border-border p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <input aria-label="id" data-testid={`ps-id-${i}`} value={ps.id} onChange={(e) => { const next = [...cfg.permissionSets]; next[i] = { ...ps, id: e.target.value }; update({ ...cfg, permissionSets: next }); }} placeholder="set-id" className="border border-border bg-background px-2 py-1 text-xs font-mono w-40" />
                <input aria-label="label" value={ps.label} onChange={(e) => { const next = [...cfg.permissionSets]; next[i] = { ...ps, label: e.target.value }; update({ ...cfg, permissionSets: next }); }} placeholder="Label" className="border border-border bg-background px-2 py-1 text-xs flex-1" />
                <button type="button" aria-label="Remove set" data-testid={`ps-remove-${i}`} onClick={() => update({ ...cfg, permissionSets: cfg.permissionSets.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="max-h-32 overflow-y-auto border border-border p-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {state.capabilities.map((c) => (
                  <label key={c.id} className="text-[11px] flex items-center gap-1.5">
                    <input type="checkbox" checked={ps.capabilities.includes(c.id)} onChange={(e) => {
                      const caps = e.target.checked ? [...ps.capabilities, c.id] : ps.capabilities.filter((x) => x !== c.id);
                      const next = [...cfg.permissionSets]; next[i] = { ...ps, capabilities: caps }; update({ ...cfg, permissionSets: next });
                    }} />
                    <span className="truncate" title={c.id}>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Custom roles */}
        <section className="space-y-2" data-testid="custom-roles-list">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest">Custom roles</h3>
            <Button type="button" variant="outline" size="sm" data-testid="add-custom-role" onClick={() => update({ ...cfg, customRoles: [...cfg.customRoles, { id: "", label: "", baseRole: state.baseRoles[0] ?? "viewer", permissionSetIds: [], groups: [] }] })}><Plus className="w-3.5 h-3.5" />Add role</Button>
          </div>
          {cfg.customRoles.length === 0 && <p className="text-xs text-muted-foreground">No custom roles yet.</p>}
          {cfg.customRoles.map((r, i) => (
            <div key={i} data-testid={`custom-role-${i}`} className="border border-border p-3 space-y-2">
              <div className="flex gap-2 items-center flex-wrap">
                <input aria-label="id" data-testid={`cr-id-${i}`} value={r.id} onChange={(e) => { const next = [...cfg.customRoles]; next[i] = { ...r, id: e.target.value }; update({ ...cfg, customRoles: next }); }} placeholder="role-id" className="border border-border bg-background px-2 py-1 text-xs font-mono w-40" />
                <input aria-label="label" value={r.label} onChange={(e) => { const next = [...cfg.customRoles]; next[i] = { ...r, label: e.target.value }; update({ ...cfg, customRoles: next }); }} placeholder="Label" className="border border-border bg-background px-2 py-1 text-xs flex-1" />
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Base</label>
                <select aria-label="base role" data-testid={`cr-base-${i}`} value={r.baseRole} onChange={(e) => { const next = [...cfg.customRoles]; next[i] = { ...r, baseRole: e.target.value }; update({ ...cfg, customRoles: next }); }} className="border border-border bg-background px-2 py-1 text-xs">
                  {state.baseRoles.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <button type="button" aria-label="Remove role" data-testid={`cr-remove-${i}`} onClick={() => update({ ...cfg, customRoles: cfg.customRoles.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              {cfg.permissionSets.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {cfg.permissionSets.filter((ps) => ps.id).map((ps) => (
                    <label key={ps.id} className="text-[11px] flex items-center gap-1.5">
                      <input type="checkbox" checked={r.permissionSetIds.includes(ps.id)} onChange={(e) => {
                        const ids = e.target.checked ? [...r.permissionSetIds, ps.id] : r.permissionSetIds.filter((x) => x !== ps.id);
                        const next = [...cfg.customRoles]; next[i] = { ...r, permissionSetIds: ids }; update({ ...cfg, customRoles: next });
                      }} />
                      {ps.label || ps.id}
                    </label>
                  ))}
                </div>
              )}
              <textarea aria-label="groups" data-testid={`cr-groups-${i}`} value={r.groups.join(", ")} onChange={(e) => { const next = [...cfg.customRoles]; next[i] = { ...r, groups: splitGroups(e.target.value) }; update({ ...cfg, customRoles: next }); }} rows={1} placeholder="idp-group-a, idp-group-b" className="w-full border border-border bg-background px-2 py-1 text-xs font-mono" />
            </div>
          ))}
        </section>

        <Button type="button" onClick={save} disabled={saving} data-testid="custom-roles-save">{saving ? "Saving…" : "Save roles & sets"}</Button>
      </CardContent>
    </Card>
  );
}
