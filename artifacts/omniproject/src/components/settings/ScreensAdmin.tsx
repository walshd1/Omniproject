import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MonitorCog } from "lucide-react";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useResolvedScreens, useOrgScreenDefs, useSaveOrgScreenDefs, type OrgScreenDef } from "../../lib/org-screens";
import { screenIsCore } from "../../lib/screen-catalogue";
import { useDisabledScreens, useSaveDisabledScreens, isScreenDisabled } from "../../lib/screen-state";
import { useCollectionEditRoles, useSaveCollectionEditRoles, type EditPolicy } from "../../lib/collection-edit-roles";
import { AdminSection } from "./AdminSection";
import { ScreenEditor } from "./ScreenEditor";

/** The settings collection a screen's editable register writes to (if it has one), for the edit-access control. */
function registerCollectionOf(screen: { panels: Array<{ kind: string; config?: Record<string, unknown> }> }): string | undefined {
  const reg = screen.panels.find((p) => p.kind === "register");
  const collection = reg?.config?.["collection"];
  return typeof collection === "string" ? collection : undefined;
}

const EDIT_POLICIES: { value: EditPolicy | "default"; label: string }[] = [
  { value: "default", label: "Default (user-editable)" },
  { value: "contributor", label: "Contributor+" },
  { value: "manager", label: "Manager+" },
  { value: "pmo", label: "PMO+" },
  { value: "admin", label: "Admin only" },
  { value: "readonly", label: "Read-only" },
];

/**
 * Screens (admin/PMO) — the control panel for every screen in the app. For each screen an admin can:
 *  - turn it OFF (it vanishes from nav; the builder shows a "turned off" state), or
 *  - OVERRIDE it with custom JSON — e.g. a customised Kanban screen — stored in the org's encrypted config
 *    and merged over the built-in by id; "Reset" drops the override back to the shipped default.
 * This owns the two settings the builder reads (disabledScreens + screenDefs); the layout of each screen is
 * still edited on the screen itself (the on-canvas layout editor).
 */
export function ScreensAdmin() {
  const { data: auth } = useAuth();
  const screens = useResolvedScreens();
  const { data: orgDefs } = useOrgScreenDefs();
  const saveDefs = useSaveOrgScreenDefs();
  const { data: disabled } = useDisabledScreens();
  const saveDisabled = useSaveDisabledScreens();
  const { data: editRoles } = useCollectionEditRoles();
  const saveEditRoles = useSaveCollectionEditRoles();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);

  if (!isPmoOrAdmin(auth?.role)) return null;

  const org = orgDefs ?? [];
  const off = disabled ?? [];
  const roles = editRoles ?? {};
  const isOverridden = (id: string) => org.some((s) => s.id === id);

  const setEditAccess = (collection: string, value: EditPolicy | "default") => {
    const next = { ...roles };
    if (value === "default") delete next[collection]; else next[collection] = value;
    saveEditRoles.mutate(next, {
      onSuccess: () => toast({ title: "EDIT ACCESS UPDATED", description: `${collection}: ${value}` }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  const toggleOff = (id: string, next: boolean) => {
    const list = next ? [...new Set([...off, id])] : off.filter((x) => x !== id);
    saveDisabled.mutate(list, {
      onSuccess: () => toast({ title: next ? "SCREEN TURNED OFF" : "SCREEN TURNED ON", description: id }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  const defFor = (id: string): OrgScreenDef =>
    org.find((s) => s.id === id) ?? screens.find((s) => s.id === id) ?? { id, label: id, panels: [] };

  const saveOverride = (id: string, edited: OrgScreenDef) => {
    // The editor can't change which screen this overrides — pin the id.
    const next = [...org.filter((s) => s.id !== id), { ...edited, id }];
    saveDefs.mutate(next, {
      onSuccess: () => { setEditingId(null); toast({ title: "SCREEN OVERRIDDEN", description: id }); },
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  const resetOverride = (id: string) => {
    saveDefs.mutate(org.filter((s) => s.id !== id), {
      onSuccess: () => { setEditingId(null); toast({ title: "RESET TO DEFAULT", description: id }); },
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={MonitorCog} title="Screens" testId="screens-admin" bodyClassName="space-y-3">
      <p className="text-xs text-muted-foreground">
        Turn a screen off, or override it with custom JSON (e.g. a customised Kanban). Overrides are stored in
        your org’s config and merged over the shipped screen by id; Reset returns to the default.
      </p>
      <div className="divide-y divide-border border-2 border-border">
        {screens.map((s) => {
          const core = screenIsCore(s.id);
          const screenOff = isScreenDisabled(off, s.id);
          const editing = editingId === s.id;
          return (
            <div key={s.id} className="p-2 space-y-2" data-testid={`screen-row-${s.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-48 font-bold text-sm">{s.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{s.id}</span>
                {core && <span className="border border-foreground px-1 text-[10px] font-bold uppercase" data-testid={`screen-core-${s.id}`}>Core</span>}
                {isOverridden(s.id) && <span className="border border-foreground px-1 text-[10px] font-bold uppercase" data-testid={`screen-overridden-${s.id}`}>Overridden</span>}
                {s.route && <span className="text-[10px] text-muted-foreground">{s.route}</span>}
                <div className="ml-auto flex items-center gap-2">
                  {core ? (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground" title="Core screens can be customised but not turned off">Always on</span>
                  ) : (
                    <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {screenOff ? "Off" : "On"}
                      <Switch checked={!screenOff} onCheckedChange={(on) => toggleOff(s.id, !on)} aria-label={`Toggle ${s.label}`} data-testid={`screen-toggle-${s.id}`} />
                    </label>
                  )}
                  {(() => {
                    const collection = registerCollectionOf(s);
                    if (!collection) return null;
                    return (
                      <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground" title="Who may edit this screen's data">
                        Edit
                        <select
                          aria-label={`Edit access for ${s.label}`}
                          data-testid={`screen-edit-access-${s.id}`}
                          value={roles[collection] ?? "default"}
                          onChange={(e) => setEditAccess(collection, e.target.value as EditPolicy | "default")}
                          className="h-7 border border-foreground bg-background px-1 text-xs"
                        >
                          {EDIT_POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </label>
                    );
                  })()}
                  {isOverridden(s.id) && !editing && (
                    <Button type="button" variant="destructive" size="sm" onClick={() => resetOverride(s.id)} data-testid={`screen-reset-${s.id}`}>Reset</Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(editing ? null : s.id)} data-testid={`screen-edit-${s.id}`}>
                    {editing ? "Close" : "Customise"}
                  </Button>
                </div>
              </div>
              {editing && (
                <ScreenEditor
                  def={defFor(s.id)}
                  allowRoute={!core}
                  saving={saveDefs.isPending}
                  onSave={(edited) => saveOverride(s.id, edited)}
                  onCancel={() => setEditingId(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </AdminSection>
  );
}
