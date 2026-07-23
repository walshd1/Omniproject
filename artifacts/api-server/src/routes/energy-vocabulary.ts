import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  ENERGY_VOCABULARY_CONFIG_ID,
  ORG_ENERGY_VOCABULARY_ID,
  resolveEnergyVocabulary,
  sanitizeEnergyVocabularyOverride,
} from "../lib/energy-vocabulary-config";

/**
 * Scope-overridable Energy vocabulary. `GET /api/energy-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/energy-vocabulary", (req, res) => {
  res.json(resolveEnergyVocabulary(vocabularyScopes(req)));
});

// PUT /api/energy-vocabulary — set the org-scope Energy vocabulary override (pmo/admin). LANE 2.
export const energyVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeEnergyVocabularyOverride> }> = {
  name: "energy-vocabulary.update",
  method: "put",
  path: "/energy-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeEnergyVocabularyOverride, "invalid energy vocabulary override"),
  run: vocabularyRun({ configId: ENERGY_VOCABULARY_CONFIG_ID, orgId: ORG_ENERGY_VOCABULARY_ID, defName: "Energy vocabulary", resolve: resolveEnergyVocabulary }),
  audit: "energy-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: ENERGY_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, energyVocabularyCommand);

export default router;
