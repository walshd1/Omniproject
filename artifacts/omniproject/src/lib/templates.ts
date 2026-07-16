import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { ProjectTemplate } from "@workspace/backend-catalogue";

/**
 * Project templates client. Templates are authored like the other config artifacts (read as a slice of
 * /api/settings, written via /api/templates, admin/PMO). Instantiating creates a project + seeds its work
 * items through the broker.
 */
export type Template = ProjectTemplate;

/** The org's project templates (the override layer only). The gallery merges these over the shipped
 *  catalogue via `resolveProjectTemplates`; see TemplatesAdmin. */
export function useTemplates() {
  return useSettingsSlice((s) => (Array.isArray(s["templates"]) ? (s["templates"] as Template[]) : []));
}

/** Persist the full template list (admin/PMO server-side). */
export function useSaveTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templates: Template[]) => sendJson<unknown>("/api/templates", { templates }, "PUT", "Failed to save templates"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}

export interface Instantiated { project: { id: string; name: string }; seeded: number }

/** Instantiate a template → a new project (with seeded work items). Manager+ server-side. */
export function instantiateTemplate(id: string, opts: { name?: string; programmeId?: string } = {}): Promise<Instantiated> {
  return sendJson<Instantiated>(`/api/templates/${encodeURIComponent(id)}/instantiate`, opts, "POST", "Failed to instantiate template");
}
