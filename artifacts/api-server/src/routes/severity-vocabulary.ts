import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  SEVERITY_VOCABULARY_CONFIG_ID,
  ORG_SEVERITY_VOCABULARY_ID,
  resolveSeverityVocabulary,
  sanitizeSeverityVocabularyOverride,
} from "../lib/severity-vocabulary-config";

/**
 * Scope-overridable Severity vocabulary. `GET /api/severity-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/severity-vocabulary", (req, res) => {
  res.json(resolveSeverityVocabulary(vocabularyScopes(req)));
});

// PUT /api/severity-vocabulary — set the org-scope Severity vocabulary override (pmo/admin). LANE 2.
export const severityVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeSeverityVocabularyOverride> }> = {
  name: "severity-vocabulary.update",
  method: "put",
  path: "/severity-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeSeverityVocabularyOverride, "invalid severity vocabulary override"),
  run: vocabularyRun({ configId: SEVERITY_VOCABULARY_CONFIG_ID, orgId: ORG_SEVERITY_VOCABULARY_ID, defName: "Severity vocabulary", resolve: resolveSeverityVocabulary }),
  audit: "severity-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: SEVERITY_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, severityVocabularyCommand);

export default router;
