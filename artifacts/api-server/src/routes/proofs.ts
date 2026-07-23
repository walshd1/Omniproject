import crypto from "node:crypto";
import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import type { Proof, ProofMeta } from "../broker/types";
import { requireRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import { proposeIfBound } from "../lib/approval-gate";
import { artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact, requireArtifactStore } from "../lib/artifact-store";
import {
  PROOF_ARTIFACT, sanitizeProofWrite, makeProofId, parseProofId, proofScope,
  newJsonProofRow, mergeJsonProofRow, applyDecision, actorLabel, isReviewDecision, proofMeta, ProofError,
  type ProofStorage,
} from "../lib/proof";
import { PROOF_DECISION_ACTION, type ProofDecisionParams } from "../lib/proof-approval";
import { mountEntity, type EntityDescriptor } from "../lib/entity-pipeline";

/**
 * PROOFING / deliverable review (roadmap 2.4). A proof references a deliverable (image/PDF, never inlined —
 * zero-at-rest) and carries typed `annotation` primitives pinned onto it, plus a review decision bound to the
 * current version. Saved to a STORAGE TARGET the author chooses — their PRIVATE / a PROJECT's / the ORG-wide
 * encrypted-JSON area (all AES-256-GCM sealed at rest) — the same pattern as whiteboards/wiki, minus the
 * sidecar (a proof is overlay metadata, always OmniProject-held). Ids are SELF-DESCRIBING (`<target>~…`), so
 * a read routes to the right store with no lookup; a `user` scope always uses the caller's own sub. Every
 * write passes the one sanitising choke point (`sanitizeProofWrite`). RBAC: read viewer+, author/annotate
 * contributor+, delete contributor+, org writes/deletes + the decision on an org proof manager+.
 */
const router = Router();

/** Per-target authorization for one proof operation (the shared storage-target gate; proofs have no sidecar). */
const authorizeTarget = (
  req: Parameters<typeof authorizeStorageTarget>[0], res: Parameters<typeof authorizeStorageTarget>[1],
  storage: ProofStorage, projectId: string | undefined, op: "read" | "write",
): Promise<boolean> =>
  authorizeStorageTarget(req, res, storage, projectId, op, { capability: false, capabilityError: "proofs are not stored in the sidecar" });

// GET /api/proofs?projectId= — the proofs (deliverable + annotations omitted) across every accessible store (viewer+).
router.get("/proofs", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_proofs failed", async () => {
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const ctx = contextFromReq(req);
    const metas: ProofMeta[] = [];
    if (ctx.sub) for (const p of listArtifacts<Proof>(PROOF_ARTIFACT, { kind: "user", sub: ctx.sub })) metas.push(proofMeta(p));
    for (const p of listArtifacts<Proof>(PROOF_ARTIFACT, { kind: "org" })) metas.push(proofMeta(p));
    if (projectId && (await assertProjectScope(req, projectId)).ok) {
      for (const p of listArtifacts<Proof>(PROOF_ARTIFACT, { kind: "project", projectId })) metas.push(proofMeta(p));
    }
    res.json(metas);
  }),
);

// GET /api/proofs/:id — one proof with its deliverable + annotations (viewer+).
router.get("/proofs/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_proof failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseProofId(id);
    if (!parsed || !artifactStoreEnabled()) { res.status(404).json({ error: "Proof not found" }); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const scope = proofScope(parsed, contextFromReq(req).sub);
    const proof = scope ? getArtifact<Proof>(PROOF_ARTIFACT, scope, id) : null;
    if (!proof) { res.status(404).json({ error: "Proof not found" }); return; }
    res.json(proof);
  }),
);

type ProofWrite = ReturnType<typeof sanitizeProofWrite>;

/**
 * Proofs — deliverable-review CRUD on the LANE 1 entity pipeline (contributor+).
 *
 * Each op runs RBAC → validate → ruleset → scope → write by construction. Update is a whole-document PUT
 * (`updateMethod`). Scope is PER-OP storage-target authorization (proofs have no project IDOR): create
 * authorizes the target the BODY names; update/delete the target the ID parses to — so each op carries its own
 * `scope` guard. The pipeline now enforces the business ruleset (create_proof / update_proof / delete_proof)
 * these hand-written routes lacked — additive, no-op under default config. POST /proofs/:id/decision stays
 * bespoke below (it holds for a signed sign-off, a 202 dual-control shape the entity pipeline doesn't model).
 */
export const proofEntity: EntityDescriptor = {
  entity: "proof",
  basePath: "/proofs",
  idParam: "id",
  updateMethod: "put",
  create: {
    role: "contributor",
    ruleAction: "create_proof",
    validate: (req, res) => {
      try { return sanitizeProofWrite(req.body); }
      catch (e) { if (e instanceof ProofError) { res.status(400).json({ error: e.message }); return null; } throw e; }
    },
    scope: { kind: "custom", guard: (req, res, body) => authorizeTarget(req, res, (body as ProofWrite).storage, (body as ProofWrite).projectId, "write") },
    run: async (req, res, body) => {
      const input = body as ProofWrite;
      if (!requireArtifactStore(res)) return undefined;
      const ctx = contextFromReq(req);
      const scope = proofScope(input, ctx.sub);
      if (!scope) { res.status(400).json({ error: "invalid storage target" }); return undefined; }
      const id = makeProofId(input.storage, crypto.randomUUID(), input.projectId);
      const row = newJsonProofRow(id, input, ctx, new Date().toISOString());
      putArtifact(PROOF_ARTIFACT, scope, row);
      return row; // 201 (pipeline default create status)
    },
  },
  update: {
    role: "contributor",
    ruleAction: "update_proof",
    validate: (req, res) => {
      try { return sanitizeProofWrite(req.body); }
      catch (e) { if (e instanceof ProofError) { res.status(400).json({ error: e.message }); return null; } throw e; }
    },
    scope: { kind: "custom", guard: async (req, res) => {
      const parsed = parseProofId(String(req.params["id"]));
      if (!parsed) { res.status(404).json({ error: "Proof not found" }); return false; }
      return authorizeTarget(req, res, parsed.storage, parsed.projectId, "write");
    } },
    run: async (req, res, body) => {
      if (!artifactStoreEnabled()) { res.status(404).json({ error: "Proof not found" }); return undefined; }
      const id = String(req.params["id"]);
      const parsed = parseProofId(id);
      const ctx = contextFromReq(req);
      const scope = parsed ? proofScope(parsed, ctx.sub) : null;
      const existing = scope ? getArtifact<Proof>(PROOF_ARTIFACT, scope, id) : null;
      if (!scope || !existing) { res.status(404).json({ error: "Proof not found" }); return undefined; }
      const row = mergeJsonProofRow(existing, body as ProofWrite, ctx, new Date().toISOString());
      putArtifact(PROOF_ARTIFACT, scope, row);
      return row; // 200
    },
  },
  remove: {
    role: "contributor",
    ruleAction: "delete_proof",
    validate: () => ({}),
    scope: { kind: "custom", guard: async (req, res) => {
      const parsed = parseProofId(String(req.params["id"]));
      if (!parsed) return true; // malformed id → nothing to delete; run 204s (idempotent), no target to authorize
      return authorizeTarget(req, res, parsed.storage, parsed.projectId, "write");
    } },
    run: async (req, res) => {
      const id = String(req.params["id"]);
      const parsed = parseProofId(id);
      if (!parsed) { res.status(204).end(); return undefined; }
      if (!artifactStoreEnabled()) { res.status(204).end(); return undefined; }
      const scope = proofScope(parsed, contextFromReq(req).sub);
      if (scope) deleteArtifact(PROOF_ARTIFACT, scope, id);
      res.status(204).end();
      return undefined;
    },
  },
};
mountEntity(router, proofEntity);

// POST /api/proofs/:id/decision — record an approve/reject/changes-requested decision, bound to the version.
// contributor+ floor; an org proof additionally needs manager+ (the storage-target gate). Identity + version
// are stamped server-side. When an admin has bound `proof.decision` to an approval chain, the decision is
// HELD for a passkey-signed sign-off (202) and only stamped onto the proof after the chain approves —
// auditable + non-repudiable. Unbound (default) ⇒ applied directly.
router.post("/proofs/:id/decision", requireRole("contributor"), (req, res) => {
  const decision = (req.body ?? {})["decision"];
  if (!isReviewDecision(decision)) { res.status(400).json({ error: "decision must be approved, rejected or changes-requested" }); return; }
  const id = String(req.params["id"]);
  const parsed = parseProofId(id);
  if (!parsed) { res.status(404).json({ error: "Proof not found" }); return; }
  return withBrokerErrors(req, res, "decide_proof failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Proof not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = proofScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Proof>(PROOF_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Proof not found" }); return; }
    // Bound to a chain? Raise a proposal, hold the decision (the executor stamps it on approval).
    const params: ProofDecisionParams = { proofId: id, scope, decision, version: existing.version ?? 1, by: actorLabel(ctx) };
    const proposalId = await proposeIfBound(PROOF_DECISION_ACTION, params, ctx.sub ?? "");
    if (proposalId) {
      res.status(202).json({
        pending: { proposalId, action: PROOF_DECISION_ACTION },
        message: "This proof decision needs a signed sign-off before it takes effect. See /api/approvals/inbox.",
      });
      return;
    }
    const row = applyDecision(existing, decision, ctx, new Date().toISOString());
    putArtifact(PROOF_ARTIFACT, scope, row);
    res.json(row);
  });
});

export default router;
