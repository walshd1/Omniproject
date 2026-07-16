import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutTemplate } from "lucide-react";
import { PROJECT_TEMPLATES, resolveProjectTemplates, type ProjectTemplate } from "@workspace/backend-catalogue";
import { useAuth, isPmoOrAdmin, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useTemplates, useSaveTemplates, instantiateTemplate, type Template } from "../../lib/templates";
import { AdminSection } from "./AdminSection";

/**
 * Templates admin — the "spin up a project from a template" gallery. The gallery shows the EFFECTIVE set:
 * the shipped starter templates merged with the org's overrides (default JSON + org override, org wins by
 * id), so a built-in is instantiable directly and an org can customise it. Admin/PMO curate the org layer
 * (customise a shipped one or add a blank); a manager+ instantiates one, which creates the project and seeds
 * its work items through the broker. The panel renders for manager+, but the editing controls only for
 * admin/PMO.
 */
const BUILTIN_IDS = new Set(PROJECT_TEMPLATES.map((t) => t.id));

function uniqueId(base: string, taken: Set<string>): string {
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export function TemplatesAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useTemplates();
  const save = useSaveTemplates();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<Template[], Template[]>(server, structuredClone);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const org = draft ?? [];
  // The gallery merges the shipped catalogue with the org's (draft) overrides so edits show live.
  const resolved = useMemo(() => resolveProjectTemplates(org), [org]);

  if (!roleAtLeast(auth?.role, "manager")) return null;
  const canEdit = isPmoOrAdmin(auth?.role);

  const orgIds = new Set(org.map((t) => t.id));
  const setById = (id: string, patch: Partial<Template>) =>
    setDraft(org.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** Copy a shipped template into the org layer (same id → it becomes an override you can edit). */
  const customise = (t: ProjectTemplate) => setDraft([...org, structuredClone(t) as Template]);
  /** Add a blank org template from scratch. */
  const addBlank = () => {
    const id = uniqueId("template", new Set([...orgIds, ...BUILTIN_IDS]));
    setDraft([...org, { id, label: "New template", seedIssues: [] } as Template]);
  };
  /** Drop an org template (reverts to the shipped default if it was an override, else removes it). */
  const removeOrg = (id: string) => setDraft(org.filter((t) => t.id !== id));

  const onSave = () => save.mutate(org, {
    onSuccess: () => toast({ title: "TEMPLATES SAVED", description: "Project templates updated." }),
    onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });

  const doInstantiate = async (t: Template) => {
    setBusy(t.id);
    try {
      const out = await instantiateTemplate(t.id, names[t.id]?.trim() ? { name: names[t.id]!.trim() } : {});
      toast({ title: "PROJECT CREATED", description: `${out.project.name} (${out.seeded} work items seeded)` });
      navigate(`/projects/${out.project.id}`);
    } catch (e) {
      toast({ title: "COULD NOT CREATE", description: e instanceof Error ? e.message : "Save the template first.", variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <AdminSection icon={LayoutTemplate} title="Templates" testId="templates-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">
        Spin up a project from a template — it creates the project and seeds its work items. The gallery shows
        the shipped starters plus your org's templates; any is ready to use. Curate the org layer below
        (admin/PMO) — customise a shipped one or add your own; any manager can instantiate.
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addBlank} data-testid="template-add-blank">Add blank template</Button>
        </div>
      )}

      {resolved.length === 0 && <p className="text-xs text-muted-foreground" data-testid="templates-empty">No templates yet.</p>}

      {resolved.map((t) => {
        const isOrg = orgIds.has(t.id);
        const isBuiltin = BUILTIN_IDS.has(t.id);
        // Instantiating uses the SERVER state, so an org row with unsaved edits must be saved first; a
        // shipped built-in with no override is always instantiable.
        const needsSave = isOrg && dirty;
        return (
          <div key={t.id} data-testid={`template-row-${t.id}`} className="rounded border border-border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">{t.id}</span>
              {canEdit && isOrg
                ? <Input aria-label={`Template ${t.id} label`} value={t.label} onChange={(e) => setById(t.id, { label: e.target.value })} className="h-8 max-w-48" />
                : <span className="font-bold">{t.label}</span>}
              {isOrg
                ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{isBuiltin ? "customised" : "org"}</span>
                : <span className="text-[10px] uppercase tracking-wide text-muted-foreground">shipped</span>}
              <span className="text-xs text-muted-foreground">{(t.seedIssues?.length ?? 0)} seed items</span>
              {t.methodology && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.methodology}</span>}
              {canEdit && (isOrg
                ? <Button type="button" variant="ghost" size="sm" onClick={() => removeOrg(t.id)} data-testid={`template-remove-${t.id}`}>{isBuiltin ? "Revert" : "Remove"}</Button>
                : <Button type="button" variant="ghost" size="sm" onClick={() => customise(t)} data-testid={`template-customise-${t.id}`}>Customise</Button>)}
            </div>
            {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={`New project name for ${t.label}`} data-testid={`template-name-${t.id}`} value={names[t.id] ?? ""} onChange={(e) => setNames((p) => ({ ...p, [t.id]: e.target.value }))} placeholder="New project name" className="h-8 max-w-48" />
              <Button type="button" size="sm" onClick={() => void doInstantiate(t)} disabled={busy === t.id || needsSave} data-testid={`template-use-${t.id}`}>{busy === t.id ? "Creating…" : "Use template"}</Button>
              {needsSave && <span className="text-[10px] text-muted-foreground">save first</span>}
            </div>
          </div>
        );
      })}

      {canEdit && (
        <div className="flex items-center gap-2">
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || save.isPending} data-testid="templates-save">{save.isPending ? "SAVING…" : "Save templates"}</Button>
        </div>
      )}
    </AdminSection>
  );
}
