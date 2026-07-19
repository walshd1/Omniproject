import { useId, useMemo, useState } from "react";
import { resolveFieldPolicy, sanitiseValue, sanitiseKeystroke, validateValue, type FieldValidation, type SanitisePolicy } from "@workspace/backend-catalogue";

/**
 * FieldControl — the runtime binding of the `decision` → `field` seam. A DECISION (settings tree) is pure
 * data: its `type` (boolean / single-choice / multi-choice / number / text / label) plus options, a value,
 * and its validation + sanitise policy. This is the VISUAL `field` that reads that type and renders the
 * matching control.
 *
 * SECURITY FLOOR: every field that captures input (i.e. type is NOT `label`) sanitises and validates through
 * the shared policy engine (`@workspace/backend-catalogue` field-validation) — the SAME rules the backend
 * field-primitive validator enforces at import time. Discrete controls (toggle/select/checkboxes) sanitise +
 * validate on change; free-text/number commit the sanitised value on blur (so typing stays natural) while
 * showing validation errors live. A `label` decision renders display-only, no control, no policy.
 */

/** The DATA half — a decision to be made (mirrors the `decision` primitive). `label` is display-only. */
export interface Decision {
  type: "boolean" | "single-choice" | "multi-choice" | "number" | "text" | "label";
  /** The allowed choices for single-/multi-choice. */
  options?: string[];
  /** The current/default value. */
  value?: string;
  /** Author validation overrides (tighten the secure default the type gives for free). */
  validation?: FieldValidation;
  /** Extra sanitise steps added to the secure default (can only tighten the floor). */
  sanitise?: SanitisePolicy;
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
  const [errors, setErrors] = useState<string[]>([]);

  // The resolved policy for this decision's type — secure defaults, tightened by any author overrides.
  const policy = useMemo(
    () => resolveFieldPolicy(decision.type, { validation: decision.validation, sanitise: decision.sanitise, options: decision.options }),
    [decision.type, decision.validation, decision.sanitise, decision.options],
  );

  // A display-only field — just its label (a caption / section heading), no control, no policy.
  if (decision.type === "label") {
    return <div className="py-1.5 text-sm font-semibold">{label}</div>;
  }

  // Two-phase sanitisation. PER KEYSTROKE: strip characters that could never be valid/safe for the type, so the
  // in-progress value is safe char-by-char as it is typed (or pasted). ON COMMIT (Enter/blur): run the full
  // sanitise policy over the whole string and validate it.

  /** Live: each keystroke keeps only safe characters, then validates the would-be committed form for feedback. */
  const onType = (raw: string) => {
    const safe = sanitiseKeystroke(raw, decision.type);
    setErrors(validateValue(sanitiseValue(safe, policy.sanitise), policy.validation, label));
    onChange?.(safe);
  };
  /** Commit: keystroke-safe THEN full policy over the whole string, validated — the at-rest value is always clean. */
  const commit = (raw: string) => {
    const clean = sanitiseValue(sanitiseKeystroke(raw, decision.type), policy.sanitise);
    setErrors(validateValue(clean, policy.validation, label));
    onChange?.(clean);
  };
  /** Commit on Enter (a single-line input's "done" signal). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit(e.currentTarget.value);
  };

  let control: React.ReactNode;
  switch (decision.type) {
    case "boolean":
      control = (
        <button
          type="button"
          role="switch"
          id={id}
          aria-checked={isOn(v)}
          onClick={() => commit(isOn(v) ? "off" : "on")}
          className={`inline-flex h-5 w-9 items-center rounded-full border border-border px-0.5 transition-colors ${isOn(v) ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`h-4 w-4 rounded-full bg-background transition-transform ${isOn(v) ? "translate-x-4" : ""}`} />
        </button>
      );
      break;
    case "single-choice":
      control = (
        <select id={id} value={v} onChange={(e) => commit(e.target.value)} className="border border-border bg-background px-2 py-1 text-sm">
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
                  commit([...next].join(","));
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
      control = <input id={id} type="number" value={v} onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown} onBlur={(e) => commit(e.target.value)} className="border border-border bg-background px-2 py-1 text-sm w-32" />;
      break;
    default:
      control = <input id={id} type="text" value={v} onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown} onBlur={(e) => commit(e.target.value)} className="border border-border bg-background px-2 py-1 text-sm" />;
      break;
  }

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-4">
        {decision.type === "multi-choice" ? (
          <span className="text-sm font-medium">{label}</span>
        ) : (
          <label htmlFor={id} className="text-sm font-medium">{label}</label>
        )}
        {control}
      </div>
      {errors.length > 0 && (
        <ul className="mt-1 text-xs text-destructive" role="alert">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}
