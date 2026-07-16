import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClipboardList } from "lucide-react";
import { FORMS, type FormDefinition, type FormFieldDef, type FormFieldType } from "@workspace/backend-catalogue";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
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
const FIELD_TYPES: FormFieldType[] = ["text", "textarea", "number", "date", "select", "checkbox", "email", "url"];

function uniqueId(base: string, taken: Set<string>): string {
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export function FormsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useForms();
  const save = useSaveForms();
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
    setDraft([...forms, { id, label: "New form", fields: [{ key: "summary", label: "Summary", type: "text", required: true }], target: { kind: "issue" } }]);
  };
  const addFromTemplate = () => {
    const tpl = FORMS.find((f) => f.id === templateId);
    if (!tpl) return;
    const id = uniqueId(tpl.id, ids);
    setDraft([...forms, { ...structuredClone(tpl as FormDefinition), id } as FormDef]);
    setTemplateId("");
  };

  // Validation: id+label, ≥1 field, unique field keys, select fields need options, a target project to submit.
  const formBad = (f: FormDef): string | null => {
    if (!f.id.trim() || !f.label.trim()) return "id and label required";
    if (f.fields.length === 0) return "at least one field";
    const keys = new Set<string>();
    for (const k of f.fields) {
      if (!k.key.trim() || !k.label.trim()) return "each field needs a key and label";
      if (keys.has(k.key)) return `duplicate field key "${k.key}"`;
      keys.add(k.key);
      if (k.type === "select" && (!k.options || k.options.length === 0)) return `select field "${k.key}" needs options`;
    }
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
                { header: "Required", cell: (k, i) => <input type="checkbox" aria-label={`Field ${i + 1} required`} checked={k.required === true} onChange={(e) => setField(fi, i, { required: e.target.checked })} /> },
                { header: "Options", cell: (k, i) => k.type === "select"
                  ? <Input aria-label={`Field ${i + 1} options`} value={(k.options ?? []).join(", ")} onChange={(e) => setField(fi, i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="h-8 max-w-40" placeholder="a, b, c" />
                  : <span className="text-xs text-muted-foreground">—</span> },
              ]}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(fi, { fields: [...f.fields, { key: uniqueId("field", new Set(f.fields.map((k) => k.key))), label: "Field", type: "text" }] })} data-testid={`form-${f.id}-add-field`}>Add field</Button>
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
