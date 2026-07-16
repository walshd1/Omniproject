import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { FormDefinition } from "@workspace/backend-catalogue";

/**
 * Intake FORMS client. Forms are authored like screens/reports: shipped TEMPLATES live in the shared
 * catalogue (`FORMS`), the org's authoritative, submittable forms live in the `forms` config store (read as
 * a slice of /api/settings, written by admin/PMO via /api/forms). The `form` panel renders a form by id and
 * a submission POSTs to /api/forms/:id/submit, which creates a work item through the broker.
 */
export type FormDef = FormDefinition;

/** The org's authored forms (the authoritative, submittable set). */
export function useForms() {
  return useSettingsSlice((s) => (Array.isArray(s["forms"]) ? (s["forms"] as FormDef[]) : []));
}

/** Persist the full forms list (admin/PMO-gated server-side). */
export function useSaveForms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (forms: FormDef[]) => sendJson<unknown>("/api/forms", { forms }, "PUT", "Failed to save forms"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}

/** Submit a filled-in form → the server validates + creates a brokered work item. */
export function submitForm(formId: string, values: Record<string, unknown>): Promise<{ ok: boolean; issue: unknown }> {
  return sendJson<{ ok: boolean; issue: unknown }>(`/api/forms/${encodeURIComponent(formId)}/submit`, { values }, "POST", "Submission failed");
}

/** Resolve one org form by id. */
export function findForm(forms: readonly FormDef[], id: string): FormDef | undefined {
  return forms.find((f) => f.id === id);
}
