import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Panel } from "../../../lib/screen";
import type { FormFieldDef } from "@workspace/backend-catalogue";
import { useForms, findForm, submitForm } from "../../../lib/forms";

/**
 * Form panel — renders an intake/request FORM authored in the org config and, on submit, creates a work item
 * through the broker (POST /api/forms/:id/submit). A form is data, like a screen or report: this primitive
 * reads the def by `config.formId` from the shared /api/settings slice and lays out its typed fields. The
 * server re-validates and owns the write, so this is a thin, generic renderer.
 *
 * config: { formId: string }  — the id of an org form (see FormsAdmin / the shared FORMS templates).
 */
type Values = Record<string, unknown>;

const emptyFor = (f: FormFieldDef): unknown =>
  f.type === "checkbox" || f.type === "yesno" ? false : f.type === "multiselect" ? [] : f.type === "address" ? {} : "";

const ADDRESS_PARTS: Array<{ key: string; label: string }> = [
  { key: "line1", label: "Address line 1" }, { key: "line2", label: "Address line 2" },
  { key: "city", label: "City" }, { key: "region", label: "Region / State" },
  { key: "postcode", label: "Postcode" }, { key: "country", label: "Country" },
];

export function FormPanel({ panel }: { panel: Panel }) {
  const c = (panel.config ?? {}) as Record<string, unknown>;
  const formId = typeof c["formId"] === "string" ? (c["formId"] as string) : "";
  const { data: forms } = useForms();
  const def = findForm(forms ?? [], formId);
  const { toast } = useToast();

  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!def) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="form-missing">
            {formId ? `Form “${formId}” isn’t configured for your organisation yet.` : "This panel has no form configured."}
            {" "}An admin or PMO can set it up under Settings → Forms.
          </p>
        </CardContent>
      </Card>
    );
  }

  const get = (f: FormFieldDef): unknown => (f.key in values ? values[f.key] : emptyFor(f));
  const set = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  const isEmpty = (f: FormFieldDef, v: unknown): boolean => {
    if (f.type === "checkbox" || f.type === "yesno") return false; // a boolean is always "answered"
    if (f.type === "multiselect") return !Array.isArray(v) || v.length === 0;
    if (f.type === "address") return !v || typeof v !== "object" || Object.values(v as Record<string, unknown>).every((x) => !String(x ?? "").trim());
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of def.fields) {
      const v = get(f);
      const s = typeof v === "string" ? v : "";
      if (f.required && isEmpty(f, v)) { next[f.key] = `${f.label} is required`; continue; }
      if (isEmpty(f, v)) continue;
      if (f.type === "number" && !Number.isFinite(Number(v))) next[f.key] = `${f.label} must be a number`;
      else if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) next[f.key] = `${f.label} must be a valid email`;
      else if (f.type === "url" && !/^https?:\/\/.+/i.test(s)) next[f.key] = `${f.label} must be a valid http(s) URL`;
      else if (f.maxLength && s.length > f.maxLength) next[f.key] = `${f.label} must be at most ${f.maxLength} characters`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      await submitForm(def.id, values);
      setDone(true);
      setValues({});
      setErrors({});
      toast({ title: "SUBMITTED", description: def.label });
    } catch (e) {
      toast({ title: "COULD NOT SUBMIT", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const title = panel.title ?? def.label;
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {def.description && <p className="mb-3 text-sm text-muted-foreground">{def.description}</p>}
        {done && (
          <div className="mb-3 rounded border border-foreground bg-muted/40 px-3 py-2 text-sm" data-testid="form-success">
            Thanks — your request has been submitted.{" "}
            <button type="button" className="underline" onClick={() => setDone(false)} data-testid="form-again">Submit another</button>
          </div>
        )}
        {!done && (
          <form
            data-testid="intake-form"
            onSubmit={(e) => { e.preventDefault(); void onSubmit(); }}
            className="flex flex-col gap-3"
          >
            {def.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm">
                <span className="font-bold">{f.label}{f.required ? " *" : ""}</span>
                {f.help && <span className="text-xs text-muted-foreground">{f.help}</span>}
                {f.type === "textarea" ? (
                  <textarea
                    data-testid={`form-field-${f.key}`}
                    value={String(get(f) ?? "")}
                    placeholder={f.placeholder ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="min-h-20 rounded border border-border bg-background px-2 py-1"
                  />
                ) : f.type === "select" ? (
                  <select
                    data-testid={`form-field-${f.key}`}
                    value={String(get(f) ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="h-9 rounded border border-border bg-background px-2"
                  >
                    <option value="">Select…</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    data-testid={`form-field-${f.key}`}
                    checked={get(f) === true}
                    onChange={(e) => set(f.key, e.target.checked)}
                    className="h-4 w-4 self-start"
                  />
                ) : f.type === "yesno" ? (
                  <div data-testid={`form-field-${f.key}`} className="flex gap-3">
                    {[["Yes", true], ["No", false]].map(([lbl, val]) => (
                      <label key={lbl as string} className="flex items-center gap-1 font-normal">
                        <input type="radio" name={f.key} checked={get(f) === val} onChange={() => set(f.key, val)} /> {lbl}
                      </label>
                    ))}
                  </div>
                ) : f.type === "radio" || f.type === "likert" ? (
                  <div data-testid={`form-field-${f.key}`} className={f.type === "likert" ? "flex flex-wrap gap-3" : "flex flex-col gap-1"}>
                    {(f.options ?? []).map((o) => (
                      <label key={o} className="flex items-center gap-1 font-normal">
                        <input type="radio" name={f.key} value={o} checked={String(get(f) ?? "") === o} onChange={() => set(f.key, o)} /> {o}
                      </label>
                    ))}
                  </div>
                ) : f.type === "multiselect" ? (
                  <div data-testid={`form-field-${f.key}`} className="flex flex-col gap-1">
                    {(f.options ?? []).map((o) => {
                      const arr = Array.isArray(get(f)) ? (get(f) as string[]) : [];
                      return (
                        <label key={o} className="flex items-center gap-1 font-normal">
                          <input type="checkbox" checked={arr.includes(o)} onChange={(e) => set(f.key, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} /> {o}
                        </label>
                      );
                    })}
                  </div>
                ) : f.type === "address" ? (
                  <div data-testid={`form-field-${f.key}`} className="flex flex-col gap-1">
                    {ADDRESS_PARTS.map((part) => {
                      const addr = (get(f) && typeof get(f) === "object" ? get(f) : {}) as Record<string, string>;
                      return (
                        <Input key={part.key} aria-label={`${f.label} ${part.label}`} data-testid={`form-field-${f.key}-${part.key}`} placeholder={part.label}
                          value={String(addr[part.key] ?? "")} onChange={(e) => set(f.key, { ...addr, [part.key]: e.target.value })} />
                      );
                    })}
                  </div>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
                    data-testid={`form-field-${f.key}`}
                    value={String(get(f) ?? "")}
                    placeholder={f.placeholder ?? ""}
                    {...(f.maxLength ? { maxLength: f.maxLength } : {})}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {errors[f.key] && <span className="text-xs text-destructive" data-testid={`form-error-${f.key}`}>{errors[f.key]}</span>}
              </label>
            ))}
            <div>
              <Button type="submit" disabled={busy} data-testid="form-submit">{def.submitLabel ?? "Submit"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
