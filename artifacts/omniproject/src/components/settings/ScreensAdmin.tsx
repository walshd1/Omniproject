import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MonitorCog } from "lucide-react";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  useResolvedScreens, useOrgScreenDefs, useLegacyOrgScreenDefs, useDrainLegacyScreenDefs,
  screenDefsResolvedKey, type OrgScreenDef,
} from "../../lib/org-screens";
import { useResolvedDefs, useImportDef, useUpdateDef, useDeleteDef } from "../../lib/defs";
import { useScreenLayouts, useDrainLegacyScreenLayouts } from "../../lib/screen-layouts";
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
  // Screen overrides are ARTIFACTS in the def store; edit the ORG-scoped `screen` defs through the importer.
  // Memoised so the derived arrays keep a stable identity across renders.
  const { data: defs } = useResolvedDefs<OrgScreenDef>("screen");
  const orgScreenDefs = useMemo(() => (Array.isArray(defs) ? defs : []).filter((d) => d.id.startsWith("org~")), [defs]);
  const scopedIdByScreenId = useMemo(() => new Map(orgScreenDefs.map((d) => [(d.payload as OrgScreenDef).id, d.id])), [orgScreenDefs]);
  const importDef = useImportDef();
  const updateDef = useUpdateDef();
  const deleteDef = useDeleteDef();
  const qc = useQueryClient();
  const { data: legacy } = useLegacyOrgScreenDefs();
  const drain = useDrainLegacyScreenDefs();
  const { data: legacyLayouts } = useScreenLayouts(); // legacy screenLayouts map (pre-fold), for migration
  const drainLayouts = useDrainLegacyScreenLayouts();
  const savingDef = importDef.isPending || updateDef.isPending || deleteDef.isPending || drain.isPending || drainLayouts.isPending;
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

  const legacyDefs = legacy ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: screenDefsResolvedKey });

  // An override is a per-def upsert through the importer: PUT an existing override's def in place, else POST a
  // new org `screen` def (payload.id pinned to the screen it overrides). The editor can't change the id.
  const saveOverride = async (id: string, edited: OrgScreenDef) => {
    const payload = { ...edited, id };
    const scopedId = scopedIdByScreenId.get(id);
    try {
      if (scopedId) await updateDef.mutateAsync({ id: scopedId, name: String(payload.label ?? id), payload });
      else await importDef.mutateAsync({ kind: "screen", storage: "org", name: String(payload.label ?? id), payload });
      await invalidate();
      setEditingId(null); toast({ title: "SCREEN OVERRIDDEN", description: id });
    } catch (e) {
      toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  // Reset = delete the override def, reverting to the shipped/built-in screen. A legacy-only override (not yet
  // migrated to a def) has no def to delete — prompt a migration first.
  const resetOverride = async (id: string) => {
    const scopedId = scopedIdByScreenId.get(id);
    if (!scopedId) { toast({ title: "MIGRATE FIRST", description: "This override is a legacy setting — migrate legacy screens, then reset." }); return; }
    try {
      await deleteDef.mutateAsync(scopedId);
      await invalidate();
      setEditingId(null); toast({ title: "RESET TO DEFAULT", description: id });
    } catch (e) {
      toast({ title: "COULD NOT RESET", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  // One-shot migration of any pre-convergence `settings.screenDefs` into the def store, then drain the slice.
  const migrateLegacy = async () => {
    try {
      for (const d of legacyDefs) if (!scopedIdByScreenId.has(d.id)) await importDef.mutateAsync({ kind: "screen", storage: "org", name: String(d.label ?? d.id), payload: d });
      await drain.mutateAsync();
      await invalidate();
      toast({ title: "MIGRATED", description: "Legacy screen overrides moved into the def store." });
    } catch (e) {
      toast({ title: "MIGRATION FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  // Fold any legacy `settings.screenLayouts` INTO the screen defs — for each customised screen, upsert its org
  // def carrying the layout, then drain the legacy map. (Layouts folded per-screen also happen live via the
  // Edit-layout mode; this bulk-migrates whatever predates the fold.)
  const legacyLayoutEntries = Object.entries(legacyLayouts ?? {});
  const migrateLayouts = async () => {
    try {
      for (const [id, layout] of legacyLayoutEntries) {
        const base = screens.find((s) => s.id === id);
        if (!base) continue;
        const def = { ...base, layout } as OrgScreenDef;
        const scopedId = scopedIdByScreenId.get(id);
        if (scopedId) await updateDef.mutateAsync({ id: scopedId, name: String(def.label ?? id), payload: def });
        else await importDef.mutateAsync({ kind: "screen", storage: "org", name: String(def.label ?? id), payload: def });
      }
      await drainLayouts.mutateAsync();
      await invalidate();
      toast({ title: "MIGRATED", description: "Legacy screen layouts folded into the def store." });
    } catch (e) {
      toast({ title: "MIGRATION FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  return (
    <AdminSection icon={MonitorCog} title="Screens" testId="screens-admin" bodyClassName="space-y-3">
      <p className="text-xs text-muted-foreground">
        Turn a screen off, or override it with custom JSON (e.g. a customised Kanban). Overrides are stored as
        definitions in your org’s encrypted def store and merged over the shipped screen by id; Reset returns to
        the default.
      </p>
      {legacyDefs.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={migrateLegacy} disabled={savingDef} data-testid="screens-migrate-legacy">
          Migrate {legacyDefs.length} legacy screen override{legacyDefs.length === 1 ? "" : "s"}
        </Button>
      )}
      {legacyLayoutEntries.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={migrateLayouts} disabled={savingDef} data-testid="screens-migrate-layouts">
          Fold {legacyLayoutEntries.length} legacy layout{legacyLayoutEntries.length === 1 ? "" : "s"} into defs
        </Button>
      )}
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
                  saving={savingDef}
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
