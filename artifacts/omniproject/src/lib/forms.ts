import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { settingsQueryKey } from "./settings-query";
import type { FormDefinition } from "@workspace/backend-catalogue";

/**
 * Intake FORMS client. Forms are ARTIFACTS: shipped TEMPLATES live in the shared catalogue (`FORMS`), and a
 * customer's authored, submittable forms live in the encrypted DEF STORE — authored through the ONE importer
 * (`POST`/`PUT /api/defs`, kind `form`), read back via `GET /api/forms/resolved` (the server unions the
 * def-store forms with any not-yet-migrated legacy `settings.forms`). The `form` panel renders a form by id
 * and a submission POSTs to `/api/forms/:id/submit`, which creates a work item through the broker. The engine
 * (renderer + submission) stays code; only the form definitions moved into the def store.
 */
export type FormDef = FormDefinition;

export const formsResolvedKey = ["forms", "resolved"] as const;
export const legacyFormsKey = ["forms", "legacy"] as const;

/** The resolved, submittable forms (def store + legacy bridge, def store winning). */
export function useForms() {
  return useQuery({
    queryKey: formsResolvedKey,
    queryFn: async () => (await getJson<{ forms: FormDef[] }>("/api/forms/resolved")).forms ?? [],
    staleTime: 15_000,
  });
}

/** The LEGACY `settings.forms` slice — only for the one-shot migration (read the old list, import each as a
 *  def, then drain). Not the render source. */
export function useLegacyForms() {
  return useQuery({
    queryKey: legacyFormsKey,
    queryFn: async () => (await getJson<{ forms: FormDef[] }>("/api/forms")).forms ?? [],
    staleTime: 30_000,
  });
}

/** Author (create) a form through the importer into a storage target (default org — governance-owned). */
export function useSaveFormDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormDef) => sendJson<{ id: string }>(
      "/api/defs",
      { kind: "form", storage: "org", name: form.label ?? form.id, payload: form },
      "POST",
      "Failed to save form",
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: formsResolvedKey }),
  });
}

/** Drain the legacy `settings.forms` slice to [] once its forms have been re-imported as defs. */
export function useDrainLegacyForms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<unknown>("/api/forms", { forms: [] }, "PUT", "Failed to drain legacy forms"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: legacyFormsKey });
      qc.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

/** Submit a filled-in form → the server validates + creates a brokered work item. */
export function submitForm(formId: string, values: Record<string, unknown>): Promise<{ ok: boolean; issue: unknown }> {
  return sendJson<{ ok: boolean; issue: unknown }>(`/api/forms/${encodeURIComponent(formId)}/submit`, { values }, "POST", "Submission failed");
}

/** Resolve one form by id. */
export function findForm(forms: readonly FormDef[], id: string): FormDef | undefined {
  return forms.find((f) => f.id === id);
}
