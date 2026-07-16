import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClipboardList } from "lucide-react";
import { FORMS, ISSUE_WRITE_TARGETS, FORM_FIELD_TYPES, type FormDefinition, type FormFieldDef, type FormFieldType } from "@workspace/backend-catalogue";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useGetCapabilities } from "@workspace/api-client-react";
import { canStoreField } from "../../lib/capabilities-fields";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useForms, useSaveForms, type FormDef } from "../../lib/forms";
import { AdminSection } from "./AdminSection";
import { EditableRowTable } from "./EditableRowTable";

/**
 * Forms admin (admin/PMO) — the visual builder behind intake forms, the same way ScreensAdmin builds screens
 * and CustomReportsAdmin builds reports. A form is a JSON def: typed fields + a target project. Start from a
 * shipped TEMPLATE (the shared FORMS catalogue) and modify it, or build one from scratch; the org's forms are
 * stored in the encrypted config store and each submission creates a work item through the broker.
 */
const FIELD_TYPES: readonly FormFieldType[] = FORM_FIELD_TYPES;

function uniqueId(base: string, taken: Set<string>): string {
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export function FormsAdmin() {
  const { data: auth } = useAuth();
  const { data: caps } = useGetCapabilities();
  const { data: server } = useForms();
  const save = useSaveForms();
  // Issue fields a form may map onto: the catalogue targets the connected backend advertises as storable.
  // title/description/labels are core (always offered); the rest are capability-gated.
  const CORE_TARGETS = new Set(["title", "description", "labels"]);
  const mapTargets = ISSUE_WRITE_TARGETS.filter((t) => CORE_TARGETS.has(t) || canStoreField(caps, t));
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<FormDef[], FormDef[]>(server, structuredClone);
  const [templateId, setTemplateId] = useState("");

  if (!isPmoOrAdmin(auth?.role)) return null;

  const forms = draft ?? [];
  const ids = new Set(forms.map((f) => f.id));
  const setForm = (i: number, patch: Partial<FormDef>) => setDraft(forms.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setField = (fi: number, ki: number, patch: Partial<FormFieldDef>) =>
    setForm(fi, { fields: forms[fi]!.fields.map((k, j) => (j === ki ? { ...k, ...patch } : k)) });

  const addBlank = () => {
    const id = uniqueId("form", ids);
    setDraft([...forms, { id, label: "New form", fields: [{ key: "summary", label: "Summary", type: "text", mapTo: "title", required: true }], target: { kind: "issue" } }]);
  };
  const addFromTemplate = () => {
    const tpl = FORMS.find((f) => f.id === templateId);
    if (!tpl) return;
    const id = uniqueId(tpl.id, ids);
    setDraft([...forms, { ...structuredClone(tpl as FormDefinition), id } as FormDef]);
    setTemplateId("");
  };

  // Validation mirrors the server: id+label, ≥1 field, unique keys, select options, EVERY field mapped to a
  // (writable) issue field, exactly one title, scalar targets unique. So a saved form always has a home for
  // every value the backend can store.
  const AGG = new Set(["description", "labels"]);
  const formBad = (f: FormDef): string | null => {
    if (!f.id.trim() || !f.label.trim()) return "id and label required";
    if (f.fields.length === 0) return "at least one field";
    const keys = new Set<string>();
    const scalars = new Set<string>();
    let titles = 0;
    for (const k of f.fields) {
      if (!k.key.trim() || !k.label.trim()) return "each field needs a key and label";
      if (keys.has(k.key)) return `duplicate field key "${k.key}"`;
      keys.add(k.key);
      if (k.type === "select" && (!k.options || k.options.length === 0)) return `select field "${k.key}" needs options`;
      if (!k.mapTo) return `field "${k.key}" must map to a backend field`;
      if (!mapTargets.includes(k.mapTo as (typeof mapTargets)[number])) return `field "${k.key}" maps to "${k.mapTo}", which the backend can't store`;
      if (k.mapTo === "title") titles++;
      if (!AGG.has(k.mapTo)) { if (scalars.has(k.mapTo)) return `two fields map to "${k.mapTo}"`; scalars.add(k.mapTo); }
    }
    if (titles !== 1) return `exactly one field must map to "title" (has ${titles})`;
    return null;
  };
  const anyBad = forms.some((f) => formBad(f) !== null) || new Set(forms.map((f) => f.id)).size !== forms.length;

  const onSave = () => save.mutate(forms, {
    onSuccess: () => toast({ title: "FORMS SAVED", description: "Intake forms updated." }),
    onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });

  return (
    <AdminSection icon={ClipboardList} title="Forms" testId="forms-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">
        Intake / request forms. Each submission creates a work item in the target project through the broker.
        Start from a template or build one from scratch; the <code>form</code> panel renders a form by id.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addBlank} data-testid="form-add-blank">New form</Button>
        <select aria-label="Form template" data-testid="form-template-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-8 border border-foreground bg-background px-1 text-xs">
          <option value="">Add from template…</option>
          {FORMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={addFromTemplate} disabled={!templateId} data-testid="form-add-template">Add</Button>
      </div>

      {forms.length === 0 && <p className="text-xs text-muted-foreground" data-testid="forms-empty">No forms yet.</p>}

      {forms.map((f, fi) => {
        const bad = formBad(f);
        return (
          <div key={f.id} data-testid={`form-row-${f.id}`} className={`rounded border p-3 space-y-2 ${bad ? "border-destructive/60" : "border-border"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">{f.id}</span>
              <Input aria-label={`Form ${fi + 1} label`} value={f.label} onChange={(e) => setForm(fi, { label: e.target.value })} className="h-8 max-w-48" placeholder="Label" />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" data-testid={`form-enabled-${f.id}`} checked={f.enabled !== false} onChange={(e) => setForm(fi, { enabled: e.target.checked })} />
                Enabled
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(forms.filter((_, j) => j !== fi))} data-testid={`form-remove-${f.id}`}>Remove</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Form ${fi + 1} target project`} value={f.target.projectId ?? ""} onChange={(e) => setForm(fi, { target: { ...f.target, projectId: e.target.value } })} className="h-8 max-w-48" placeholder="Target project id" />
              <Input aria-label={`Form ${fi + 1} description`} value={f.description ?? ""} onChange={(e) => setForm(fi, { description: e.target.value })} className="h-8 max-w-64" placeholder="Description" />
            </div>

            <EditableRowTable
              rows={f.fields}
              rowKey={(_, i) => i}
              rowTestId={(_, i) => `form-${f.id}-field-${i}`}
              onRemove={(i) => setForm(fi, { fields: f.fields.filter((_, j) => j !== i) })}
              removeLabel={(i) => `Remove field ${i + 1}`}
              emptyText="No fields."
              columns={[
                { header: "Key", cell: (k, i) => <Input aria-label={`Field ${i + 1} key`} value={k.key} onChange={(e) => setField(fi, i, { key: e.target.value })} className="h-8 max-w-32" /> },
                { header: "Label", cell: (k, i) => <Input aria-label={`Field ${i + 1} label`} value={k.label} onChange={(e) => setField(fi, i, { label: e.target.value })} className="h-8 max-w-40" /> },
                { header: "Type", cell: (k, i) => (
                  <select aria-label={`Field ${i + 1} type`} value={k.type} onChange={(e) => setField(fi, i, { type: e.target.value as FormFieldType })} className="h-8 border border-foreground bg-background px-1 text-xs">
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) },
                { header: "Maps to", cell: (k, i) => (
                  <select aria-label={`Field ${i + 1} maps to`} value={k.mapTo ?? ""} onChange={(e) => setField(fi, i, { mapTo: e.target.value })} className={`h-8 border bg-background px-1 text-xs ${k.mapTo && !mapTargets.includes(k.mapTo as (typeof mapTargets)[number]) ? "border-destructive" : "border-foreground"}`}>
                    <option value="">— pick a field —</option>
                    {mapTargets.map((t) => <option key={t} value={t}>{t}</option>)}
                    {k.mapTo && !mapTargets.includes(k.mapTo as (typeof mapTargets)[number]) && <option value={k.mapTo}>{k.mapTo} (unsupported)</option>}
                  </select>
                ) },
                { header: "Required", cell: (k, i) => <input type="checkbox" aria-label={`Field ${i + 1} required`} checked={k.required === true} onChange={(e) => setField(fi, i, { required: e.target.checked })} /> },
                { header: "Options", cell: (k, i) => k.type === "select"
                  ? <Input aria-label={`Field ${i + 1} options`} value={(k.options ?? []).join(", ")} onChange={(e) => setField(fi, i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="h-8 max-w-40" placeholder="a, b, c" />
                  : <span className="text-xs text-muted-foreground">—</span> },
              ]}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(fi, { fields: [...f.fields, { key: uniqueId("field", new Set(f.fields.map((k) => k.key))), label: "Field", type: "text", mapTo: "description" }] })} data-testid={`form-${f.id}-add-field`}>Add field</Button>
            {bad && <p className="text-xs text-destructive" data-testid={`form-bad-${f.id}`}>{bad}</p>}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || anyBad || save.isPending} data-testid="forms-save">{save.isPending ? "SAVING…" : "Save forms"}</Button>
      </div>
    </AdminSection>
  );
}
