import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  TASK_CONTEXT_VOCABULARY_CONFIG_ID,
  ORG_TASK_CONTEXT_VOCABULARY_ID,
  resolveTaskContextVocabulary,
  sanitizeTaskContextVocabularyOverride,
} from "../lib/task-context-vocabulary-config";

/**
 * Scope-overridable GTD task-context vocabulary. `GET /api/task-context-vocabulary` resolves the effective
 * contexts for the caller's scope (any authed user, for the context picker + colours); `PUT` sets the
 * org-scope override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from
 * lib/vocabulary-command — centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/task-context-vocabulary", (req, res) => {
  res.json(resolveTaskContextVocabulary(vocabularyScopes(req)));
});

// PUT /api/task-context-vocabulary — set the org-scope context vocabulary override (pmo/admin). LANE 2.
export const taskContextVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeTaskContextVocabularyOverride> }> = {
  name: "task-context-vocabulary.update",
  method: "put",
  path: "/task-context-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeTaskContextVocabularyOverride, "invalid task context vocabulary override"),
  run: vocabularyRun({ configId: TASK_CONTEXT_VOCABULARY_CONFIG_ID, orgId: ORG_TASK_CONTEXT_VOCABULARY_ID, defName: "Task context vocabulary", resolve: resolveTaskContextVocabulary }),
  audit: "task-context-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: TASK_CONTEXT_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, taskContextVocabularyCommand);

export default router;
