import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  LIKELIHOOD_VOCABULARY_CONFIG_ID,
  ORG_LIKELIHOOD_VOCABULARY_ID,
  resolveLikelihoodVocabulary,
  sanitizeLikelihoodVocabularyOverride,
} from "../lib/likelihood-vocabulary-config";

/**
 * Scope-overridable Likelihood vocabulary. `GET /api/likelihood-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/likelihood-vocabulary", (req, res) => {
  res.json(resolveLikelihoodVocabulary(vocabularyScopes(req)));
});

// PUT /api/likelihood-vocabulary — set the org-scope Likelihood vocabulary override (pmo/admin). LANE 2.
export const likelihoodVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeLikelihoodVocabularyOverride> }> = {
  name: "likelihood-vocabulary.update",
  method: "put",
  path: "/likelihood-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeLikelihoodVocabularyOverride, "invalid likelihood vocabulary override"),
  run: vocabularyRun({ configId: LIKELIHOOD_VOCABULARY_CONFIG_ID, orgId: ORG_LIKELIHOOD_VOCABULARY_ID, defName: "Likelihood vocabulary", resolve: resolveLikelihoodVocabulary }),
  audit: "likelihood-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: LIKELIHOOD_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, likelihoodVocabularyCommand);

export default router;
