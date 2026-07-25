import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  WORK_VOCABULARY_CONFIG_ID,
  ORG_WORK_VOCABULARY_ID,
  resolveWorkVocabulary,
  sanitizeWorkVocabularyOverride,
} from "../lib/work-vocabulary-config";

/**
 * Scope-overridable Work vocabulary. `GET /api/work-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/work-vocabulary", (req, res) => {
  res.json(resolveWorkVocabulary(vocabularyScopes(req)));
});

// PUT /api/work-vocabulary — set the org-scope Work vocabulary override (pmo/admin). LANE 2.
export const workVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeWorkVocabularyOverride> }> = {
  name: "work-vocabulary.update",
  method: "put",
  path: "/work-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeWorkVocabularyOverride, "invalid work vocabulary override"),
  run: vocabularyRun({ configId: WORK_VOCABULARY_CONFIG_ID, orgId: ORG_WORK_VOCABULARY_ID, defName: "Work vocabulary", resolve: resolveWorkVocabulary }),
  audit: "work-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: WORK_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, workVocabularyCommand);

export default router;
