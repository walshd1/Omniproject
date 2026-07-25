import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  TASK_VOCABULARY_CONFIG_ID,
  ORG_TASK_VOCABULARY_ID,
  resolveTaskVocabulary,
  sanitizeTaskVocabularyOverride,
} from "../lib/task-vocabulary-config";

/**
 * Scope-overridable Task vocabulary. `GET /api/task-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/task-vocabulary", (req, res) => {
  res.json(resolveTaskVocabulary(vocabularyScopes(req)));
});

// PUT /api/task-vocabulary — set the org-scope Task vocabulary override (pmo/admin). LANE 2.
export const taskVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeTaskVocabularyOverride> }> = {
  name: "task-vocabulary.update",
  method: "put",
  path: "/task-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeTaskVocabularyOverride, "invalid task vocabulary override"),
  run: vocabularyRun({ configId: TASK_VOCABULARY_CONFIG_ID, orgId: ORG_TASK_VOCABULARY_ID, defName: "Task vocabulary", resolve: resolveTaskVocabulary }),
  audit: "task-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: TASK_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, taskVocabularyCommand);

export default router;
