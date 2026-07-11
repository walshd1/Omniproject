import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALL_OPS, UNARY_OPS, ARRAY_OPS, type Predicate, type Op } from "../../lib/rate-card";
import { useRowKeys } from "../../hooks/use-row-keys";

/**
 * Reusable "when" builder — edits the `all` (AND) predicates of a condition set. Shared by the cost-rule
 * and governance-rule editors so the two rule planes author conditions identically. A predicate is a
 * context field, an operator, and (for binary ops) a value; unary ops drop the value, array ops parse a
 * comma list. Numeric-looking scalars are sent as numbers so `eq`/`gt`/`in` behave on numeric fields.
 */

/** Parse one scalar: a finite number stays numeric, everything else is a trimmed string. */
function parseScalar(raw: string): string | number {
  const t = raw.trim();
  const n = Number(t);
  return t !== "" && isFinite(n) ? n : t;
}

/** Build a predicate's `value` from the raw input for the given op (undefined for unary ops). */
function parseValue(op: Op, raw: string): unknown {
  if (UNARY_OPS.includes(op)) return undefined;
  if (ARRAY_OPS.includes(op)) return raw.split(",").map((s) => parseScalar(s)).filter((v) => v !== "");
  return parseScalar(raw);
}

/** Render a predicate's stored value back into the input box. */
function valueToText(p: Predicate): string {
  if (UNARY_OPS.includes(p.op)) return "";
  if (Array.isArray(p.value)) return p.value.join(", ");
  return p.value === undefined ? "" : String(p.value);
}

export function PredicateEditor({
  value, onChange, fieldOptions, idPrefix,
}: {
  value: Predicate[];
  onChange: (preds: Predicate[]) => void;
  /** When given, the field is a fixed-choice select (e.g. governance: programmeId/projectId/projectType). */
  fieldOptions?: string[];
  idPrefix: string;
}) {
  const patch = (i: number, p: Partial<Predicate>) => onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const rowKeys = useRowKeys(value.length);
  const removeAt = (i: number) => { rowKeys.removeAt(i); onChange(value.filter((_, j) => j !== i)); };

  return (
    <div className="space-y-1.5" data-testid={`${idPrefix}-predicates`}>
      {value.length === 0 && <p className="text-[11px] text-muted-foreground">No conditions — this rule always applies.</p>}
      {value.map((p, i) => (
        <div key={rowKeys.keyAt(i)} className="flex flex-wrap items-center gap-2" data-testid={`${idPrefix}-pred-${i}`}>
          {fieldOptions ? (
            <select aria-label={`${idPrefix} condition ${i + 1} field`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
              value={p.field} onChange={(e) => patch(i, { field: e.target.value })}>
              <option value="">field…</option>
              {fieldOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <Input aria-label={`${idPrefix} condition ${i + 1} field`} placeholder="field (e.g. budget)" className="w-40 rounded-none border border-border font-mono text-xs"
              value={p.field} onChange={(e) => patch(i, { field: e.target.value })} />
          )}
          <select aria-label={`${idPrefix} condition ${i + 1} operator`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
            value={p.op} onChange={(e) => {
              const op = e.target.value as Op;
              // Drop a now-meaningless value when switching to a unary op.
              patch(i, UNARY_OPS.includes(op) ? { op, value: undefined } : { op });
            }}>
            {ALL_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {!UNARY_OPS.includes(p.op) && (
            <Input aria-label={`${idPrefix} condition ${i + 1} value`} placeholder={ARRAY_OPS.includes(p.op) ? "a, b, c" : "value"}
              className="w-40 rounded-none border border-border text-xs"
              value={valueToText(p)} onChange={(e) => patch(i, { value: parseValue(p.op, e.target.value) })} />
          )}
          <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`${idPrefix} remove condition ${i + 1}`}
            onClick={() => removeAt(i)}>✕</Button>
        </div>
      ))}
      <Button variant="outline" className="rounded-none border border-border text-xs"
        onClick={() => onChange([...value, { field: fieldOptions?.[0] ?? "", op: "eq", value: "" }])}>+ condition</Button>
    </div>
  );
}
