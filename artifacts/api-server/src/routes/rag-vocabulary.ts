import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { vocabularyScopes, vocabularyParse, vocabularyRun } from "../lib/vocabulary-command";
import {
  RAG_VOCABULARY_CONFIG_ID,
  ORG_RAG_VOCABULARY_ID,
  resolveRagVocabulary,
  sanitizeRagVocabularyOverride,
} from "../lib/rag-vocabulary-config";

/**
 * Scope-overridable RAG vocabulary. `GET /api/rag-vocabulary` resolves the effective levels for the
 * caller's scope (any authed user, for display + the write-path membership check); `PUT` sets the org-scope
 * override (pmo/admin). The read resolver + the Lane-2 write's parse/run come from lib/vocabulary-command —
 * centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */
const router = Router();

router.get("/rag-vocabulary", (req, res) => {
  res.json(resolveRagVocabulary(vocabularyScopes(req)));
});

// PUT /api/rag-vocabulary — set the org-scope RAG vocabulary override (pmo/admin). LANE 2.
export const ragVocabularyCommand: CommandDescriptor<{ values: ReturnType<typeof sanitizeRagVocabularyOverride> }> = {
  name: "rag-vocabulary.update",
  method: "put",
  path: "/rag-vocabulary",
  gates: [requireAnyRole("pmo", "admin")],
  parse: vocabularyParse(sanitizeRagVocabularyOverride, "invalid RAG vocabulary override"),
  run: vocabularyRun({ configId: RAG_VOCABULARY_CONFIG_ID, orgId: ORG_RAG_VOCABULARY_ID, defName: "RAG vocabulary", resolve: resolveRagVocabulary }),
  audit: "rag-vocabulary.update",
  auditCategory: "admin",
  auditMeta: () => ({ configId: RAG_VOCABULARY_CONFIG_ID }),
};
mountCommand(router, ragVocabularyCommand);

export default router;
