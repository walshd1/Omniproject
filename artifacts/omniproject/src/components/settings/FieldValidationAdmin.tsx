import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "lucide-react";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useCustomFields } from "../../lib/custom-fields";
import { useFieldValidation, useSaveFieldValidation, type FieldValidationRule } from "../../lib/field-validation";
import { isSafePattern } from "../../lib/safe-regex";

const CANONICAL_ELEMENTS = [...CANONICAL_FIELD_KEYS].sort();
const empty = (): FieldValidationRule => ({ field: "" });

/** A blank pattern is fine; otherwise it must pass the shared safe-regex guard. */
function patternOk(p: string | undefined): boolean {
  return !p || isSafePattern(p);
}

/** A blank date is fine; otherwise it must parse. */
function dateOk(d: string | undefined): boolean {
  return !d || Number.isFinite(Date.parse(d));
}

/**
 * Field validation rules (admin) — the constraints a field's VALUE must satisfy (required, min/max,
 * pattern, allowed set), layered on top of the field's type. Sits with the routing matrix: routing
 * decides WHERE a value comes from, this decides what a valid value IS. The server re-validates the
 * rule definitions and enforces them on the write path; a bad value is a 400.
 */
export function FieldValidationAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useFieldValidation();
  const { data: customFields } = useCustomFields();
  const save = useSaveFieldValidation();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<FieldValidationRule[], FieldValidationRule[]>(server, structuredClone);

  if (!roleAtLeast(auth?.role, "admin")) return null;

  // The fields you can constrain: the reference superset plus any admin-defined custom fields.
  const fields = [...CANONICAL_ELEMENTS, ...(customFields ?? []).map((f) => f.key)];
  const rows = draft ?? [];
  const set = (i: number, patch: Partial<FieldValidationRule>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Local shape feedback (the server is authoritative).
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const f = r.field.trim();
    const rangeBad = r.min !== undefined && r.max !== undefined && r.min > r.max;
    const dateBad = !dateOk(r.after) || !dateOk(r.before) || (!!r.after && !!r.before && Date.parse(r.after) > Date.parse(r.before));
    if (!f || seen.has(f) || rangeBad || dateBad || !patternOk(r.pattern)) badRows.add(i);
    if (f) seen.add(f);
  });

  const num = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
  const opts = (s: string): string[] => [...new Set(s.split(",").map((o) => o.trim()).filter(Boolean))];
  // A blank min/max clears the bound (delete the key) rather than storing `undefined`.
  const setNum = (i: number, key: "min" | "max", s: string) =>
    setDraft(rows.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r };
      const n = num(s);
      if (n === undefined) delete next[key];
      else next[key] = n;
      return next;
    }));

  const onSave = () => {
    const cleaned = rows.map((r) => {
      const out: FieldValidationRule = { field: r.field.trim() };
      if (r.required) out.required = true;
      if (r.min !== undefined && Number.isFinite(r.min)) out.min = r.min;
      if (r.max !== undefined && Number.isFinite(r.max)) out.max = r.max;
      if (r.pattern?.trim()) out.pattern = r.pattern.trim();
      if (r.after?.trim()) out.after = r.after.trim();
      if (r.before?.trim()) out.before = r.before.trim();
      if (r.options && r.options.length) out.options = r.options;
      return out;
    });
    save.mutate(cleaned, {
      onSuccess: () => toast({ title: "VALIDATION SAVED", description: "Field rules updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Check the rule shapes.", variant: "destructive" }),
    });
  };

  return (
    <section data-testid="field-validation-admin">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Field validation rules</h2>
      </div>
      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Constrain a field's <strong>value</strong>: mark it required, set min/max (value bounds for numbers,
          length for text), a date range with <strong>after/before</strong> (date fields — a real date
          comparison, not a regex), a <strong>pattern</strong> (regex, text only) or an <strong>allowed set</strong>.
          Enforced server-side on write — a bad value is rejected.
        </p>

        <datalist id="validation-fields">
          {fields.map((k) => <option key={k} value={k} />)}
        </datalist>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="p-1 font-bold">Field</th>
                <th className="p-1 font-bold">Req</th>
                <th className="p-1 font-bold">Min</th>
                <th className="p-1 font-bold">Max</th>
                <th className="p-1 font-bold">After</th>
                <th className="p-1 font-bold">Before</th>
                <th className="p-1 font-bold">Pattern</th>
                <th className="p-1 font-bold">Options (comma)</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={badRows.has(i) ? "bg-red-500/10" : undefined} data-testid={`validation-row-${i}`}>
                  <td className="p-1"><Input list="validation-fields" aria-label={`Rule ${i + 1} field`} value={r.field} onChange={(e) => set(i, { field: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="p-1 text-center">
                    <input type="checkbox" aria-label={`Rule ${i + 1} required`} checked={!!r.required} onChange={(e) => set(i, { required: e.target.checked })} />
                  </td>
                  <td className="p-1"><Input aria-label={`Rule ${i + 1} min`} value={r.min ?? ""} onChange={(e) => setNum(i, "min", e.target.value)} className="h-8 w-16" inputMode="numeric" /></td>
                  <td className="p-1"><Input aria-label={`Rule ${i + 1} max`} value={r.max ?? ""} onChange={(e) => setNum(i, "max", e.target.value)} className="h-8 w-16" inputMode="numeric" /></td>
                  <td className="p-1"><Input type="date" aria-label={`Rule ${i + 1} after`} value={r.after ?? ""} onChange={(e) => set(i, { after: e.target.value })} className="h-8" /></td>
                  <td className="p-1"><Input type="date" aria-label={`Rule ${i + 1} before`} value={r.before ?? ""} onChange={(e) => set(i, { before: e.target.value })} className="h-8" /></td>
                  <td className="p-1"><Input aria-label={`Rule ${i + 1} pattern`} value={r.pattern ?? ""} onChange={(e) => set(i, { pattern: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="p-1"><Input aria-label={`Rule ${i + 1} options`} value={(r.options ?? []).join(", ")} onChange={(e) => set(i, { options: opts(e.target.value) })} className="h-8" /></td>
                  <td className="p-1">
                    <button type="button" aria-label={`Remove rule ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500 px-2">×</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="p-3 text-center text-muted-foreground">No rules — every value is accepted for its type.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="validation-add">Add rule</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="validation-save">
            {save.isPending ? "SAVING…" : "Save rules"}
          </Button>
        </div>
      </div>
    </section>
  );
}
