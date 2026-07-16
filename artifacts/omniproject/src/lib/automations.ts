import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { AutomationRecipe, ActionRequirement } from "@workspace/backend-catalogue";

/**
 * Automation recipes client. Recipes are authored like the other config artifacts — read as a slice of
 * /api/settings, written via /api/automations (the server enforces that a user may only automate what they
 * may edit). `previewAutomation` dry-runs a draft: it compiles to the workflow engine and reports the RBAC
 * requirements, whether it mutates (⇒ needs an autonomous grant to run), and whether the caller may author it.
 */
export type Automation = AutomationRecipe;

export interface AutomationPreview {
  workflow: { id: string; steps: unknown[] };
  requirements: ActionRequirement[];
  mutates: boolean;
  canAuthor: boolean;
  reason?: string;
}

/** The org's automation recipes. */
export function useAutomations() {
  return useSettingsSlice((s) => (Array.isArray(s["automations"]) ? (s["automations"] as Automation[]) : []));
}

/** Persist the full recipe list (server rejects a recipe the author isn't permitted to run). */
export function useSaveAutomations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (automations: Automation[]) => sendJson<unknown>("/api/automations", { automations }, "PUT", "Failed to save automations"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}

/** Dry-run a draft recipe: compile + requirements + can-author, no side effects. */
export function previewAutomation(recipe: Automation): Promise<AutomationPreview> {
  return sendJson<AutomationPreview>("/api/automations/preview", { recipe }, "POST", "Preview failed");
}

export interface AutomationRun {
  matched: boolean;
  ran: boolean;
  pending?: string;
  message?: string;
  results?: Record<string, unknown>;
}

/** Run a stored recipe now against a `subject` (a test entity). Inform recipes fire; mutating recipes are
 *  held for an autonomous grant (202). */
export function runAutomation(id: string, subject: Record<string, unknown> = {}): Promise<AutomationRun> {
  return sendJson<AutomationRun>(`/api/automations/${encodeURIComponent(id)}/run`, { subject }, "POST", "Run failed");
}
