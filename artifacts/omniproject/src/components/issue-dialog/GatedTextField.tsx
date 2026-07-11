import type { Dispatch, SetStateAction, InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import type { IssueForm, FieldPredicate } from "./use-issue-form";

/** The string-valued keys of the issue form — the only fields a text input can bind to. */
type StringFieldKey = { [K in keyof IssueForm]: IssueForm[K] extends string ? K : never }[keyof IssueForm];

interface GatedTextFieldProps {
  /** The form field this input binds to (a string-valued key). */
  name: StringFieldKey;
  /** The `<label>` text; also the input's accessible name. */
  label: string;
  form: IssueForm;
  setForm: Dispatch<SetStateAction<IssueForm>>;
  /** Whether the backend can surface the field (hidden entirely when false). */
  showF: FieldPredicate;
  /** Whether the field is writable (input disabled when false). */
  editF: FieldPredicate;
  /** DOM id, defaulting to `issue-<name>`; pass an explicit kebab id to match an existing one. */
  id?: string;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  /** Optional value transform on change (e.g. upper-casing a currency code). */
  transform?: (v: string) => string;
  /** Extra classes appended to the shared input styling (e.g. `uppercase`). */
  className?: string;
}

/**
 * One capability-gated text field for the issue dialog: hidden when the backend can't surface it,
 * disabled when it can't store it, and bound to a string form field. Collapses the ~6-line
 * show/label/Input/onChange block that was hand-repeated across every dialog panel into one element.
 */
export function GatedTextField({
  name, label, form, setForm, showF, editF, id, placeholder, type, inputMode, maxLength, transform, className,
}: GatedTextFieldProps) {
  if (!showF(name)) return null;
  const inputId = id ?? `issue-${name}`;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input
        id={inputId}
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        value={form[name]}
        disabled={!editF(name)}
        onChange={(e) => {
          const value = transform ? transform(e.target.value) : e.target.value;
          setForm((p) => ({ ...p, [name]: value }));
        }}
        placeholder={placeholder}
        className={`rounded-none border-border font-mono disabled:opacity-60${className ? ` ${className}` : ""}`}
      />
    </div>
  );
}
