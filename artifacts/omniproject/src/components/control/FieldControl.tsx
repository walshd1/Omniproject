import { useId } from "react";

/**
 * FieldControl — the runtime binding of the `decision` → `field` seam. A DECISION (settings tree) is
 * pure data: its `type` (boolean / single-choice / multi-choice / number / text) plus options and a
 * value. This is the VISUAL `field` that reads that type and renders the matching control — a toggle
 * for boolean, a select for single-choice, checkboxes for multi-choice, a number/text input otherwise
 * — so the decision's type tells the visual what to render and with what options. Controlled: pass
 * `value` + `onChange`, or let it show the decision's default read-only.
 */

/** The DATA half — a decision to be made (mirrors the `decision` primitive). */
export interface Decision {
  type: "boolean" | "single-choice" | "multi-choice" | "number" | "text";
  /** The allowed choices for single-/multi-choice. */
  options?: string[];
  /** The current/default value. */
  value?: string;
}

const isOn = (v: string) => v === "on" || v === "true" || v === "yes";

export function FieldControl({
  label,
  decision,
  value,
  onChange,
}: {
  label: string;
  decision: Decision;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const v = value ?? decision.value ?? "";
  const options = decision.options ?? [];
  const emit = (next: string) => onChange?.(next);

  let control: React.ReactNode;
  switch (decision.type) {
    case "boolean":
      control = (
        <button
          type="button"
          role="switch"
          id={id}
          aria-checked={isOn(v)}
          onClick={() => emit(isOn(v) ? "off" : "on")}
          className={`inline-flex h-5 w-9 items-center rounded-full border border-border px-0.5 transition-colors ${isOn(v) ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`h-4 w-4 rounded-full bg-background transition-transform ${isOn(v) ? "translate-x-4" : ""}`} />
        </button>
      );
      break;
    case "single-choice":
      control = (
        <select id={id} value={v} onChange={(e) => emit(e.target.value)} className="border border-border bg-background px-2 py-1 text-sm">
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
      break;
    case "multi-choice": {
      const selected = new Set(v ? v.split(",").filter(Boolean) : []);
      control = (
        <div role="group" aria-label={label} className="flex flex-wrap gap-3">
          {options.map((o) => (
            <label key={o} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.has(o)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o);
                  else next.delete(o);
                  emit([...next].join(","));
                }}
              />
              {o}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "number":
      control = <input id={id} type="number" value={v} onChange={(e) => emit(e.target.value)} className="border border-border bg-background px-2 py-1 text-sm w-32" />;
      break;
    default:
      control = <input id={id} type="text" value={v} onChange={(e) => emit(e.target.value)} className="border border-border bg-background px-2 py-1 text-sm" />;
      break;
  }

  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      {decision.type === "multi-choice" ? (
        <span className="text-sm font-medium">{label}</span>
      ) : (
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
      )}
      {control}
    </div>
  );
}
