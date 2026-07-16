import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutTemplate } from "lucide-react";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "@workspace/backend-catalogue";
import { useAuth, isPmoOrAdmin, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useTemplates, useSaveTemplates, instantiateTemplate, type Template } from "../../lib/templates";
import { AdminSection } from "./AdminSection";

/**
 * Templates admin — the "spin up a project from a template" gallery. Admin/PMO curate the org's templates
 * (start from a shipped one or build from scratch); a manager+ instantiates one, which creates the project
 * and seeds its work items through the broker. Instantiation is available to managers even though authoring
 * is admin/PMO — so the panel renders for manager+, but the editing controls only for admin/PMO.
 */
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
  const [tpl, setTpl] = useState("");

  if (!roleAtLeast(auth?.role, "manager")) return null;
  const canEdit = isPmoOrAdmin(auth?.role);

  const templates = draft ?? [];
  const ids = new Set(templates.map((t) => t.id));
  const setT = (i: number, patch: Partial<Template>) => setDraft(templates.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const addFromCatalogue = () => {
    const src = PROJECT_TEMPLATES.find((t) => t.id === tpl);
    if (!src) return;
    setDraft([...templates, { ...structuredClone(src as ProjectTemplate), id: uniqueId(src.id, ids) } as Template]);
    setTpl("");
  };

  const onSave = () => save.mutate(templates, {
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
        Spin up a project from a template — it creates the project and seeds its work items. Curate templates
        below (admin/PMO); any manager can instantiate one.
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Template catalogue" data-testid="template-catalogue-select" value={tpl} onChange={(e) => setTpl(e.target.value)} className="h-8 border border-foreground bg-background px-1 text-xs">
            <option value="">Add from catalogue…</option>
            {PROJECT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={addFromCatalogue} disabled={!tpl} data-testid="template-add-catalogue">Add</Button>
        </div>
      )}

      {templates.length === 0 && <p className="text-xs text-muted-foreground" data-testid="templates-empty">No templates yet.</p>}

      {templates.map((t, i) => (
        <div key={t.id} data-testid={`template-row-${t.id}`} className="rounded border border-border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{t.id}</span>
            {canEdit
              ? <Input aria-label={`Template ${i + 1} label`} value={t.label} onChange={(e) => setT(i, { label: e.target.value })} className="h-8 max-w-48" />
              : <span className="font-bold">{t.label}</span>}
            <span className="text-xs text-muted-foreground">{(t.seedIssues?.length ?? 0)} seed items</span>
            {canEdit && <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(templates.filter((_, j) => j !== i))} data-testid={`template-remove-${t.id}`}>Remove</Button>}
          </div>
          {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={`New project name for ${t.label}`} data-testid={`template-name-${t.id}`} value={names[t.id] ?? ""} onChange={(e) => setNames((p) => ({ ...p, [t.id]: e.target.value }))} placeholder="New project name" className="h-8 max-w-48" />
            <Button type="button" size="sm" onClick={() => void doInstantiate(t)} disabled={busy === t.id || dirty} data-testid={`template-use-${t.id}`}>{busy === t.id ? "Creating…" : "Use template"}</Button>
            {dirty && <span className="text-[10px] text-muted-foreground">save first</span>}
          </div>
        </div>
      ))}

      {canEdit && (
        <div className="flex items-center gap-2">
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || save.isPending} data-testid="templates-save">{save.isPending ? "SAVING…" : "Save templates"}</Button>
        </div>
      )}
    </AdminSection>
  );
}
