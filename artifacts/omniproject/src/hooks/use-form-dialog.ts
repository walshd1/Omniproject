import { useState } from "react";

/**
 * The reset-on-close form pattern shared by the simple create dialogs: hold a
 * draft form, reset it back to `initial` whenever the dialog is dismissed. The
 * caller wires `close` to the Dialog's `onOpenChange` (after its own side
 * effects, or directly).
 */
export function useFormDialog<T>(initial: T) {
  const [form, setForm] = useState<T>(initial);
  const reset = () => setForm(initial);
  const close = (open: boolean) => {
    if (!open) reset();
  };
  return { form, setForm, reset, close };
}
