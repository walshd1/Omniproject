import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  IMPACT_VOCABULARY_CONFIG_ID,
  ORG_IMPACT_VOCABULARY_ID,
  resolveImpactVocabulary,
  sanitizeImpactVocabularyOverride,
} from "../lib/impact-vocabulary-config";

/**
 * Scope-overridable Impact vocabulary. `GET /api/impact-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/impact-vocabulary", (req, res) => {
  res.json(resolveImpactVocabulary(vocabularyScopes(req)));
});

// PUT /api/impact-vocabulary — set the org-scope Impact vocabulary override (pmo/admin). LANE 2.
export const impactVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeImpactVocabularyOverride> }> = {
  name: "impact-vocabulary.update",
  method: "put",
  path: "/impact-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeImpactVocabularyOverride, "invalid impact vocabulary override"),
  run: vocabularyRun({ configId: IMPACT_VOCABULARY_CONFIG_ID, orgId: ORG_IMPACT_VOCABULARY_ID, defName: "Impact vocabulary", resolve: resolveImpactVocabulary }),
  audit: "impact-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: IMPACT_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, impactVocabularyCommand);

export default router;
