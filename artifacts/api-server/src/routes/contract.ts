import { Router, type IRouter } from "express";
import { CONTRACT_VERSION } from "../broker/contract";
import { BROKER_CONTRACT_SCHEMA } from "../broker/contract.schema.generated";

const router: IRouter = Router();

/**
 * GET /api/contract — the published, versioned broker contract.
 *
 * Public (the contract is documentation, not data): a prospective broker
 * implementer can fetch the machine-readable JSON Schema and the version
 * straight from a running gateway. The schema is the embedded copy generated
 * from broker/{types,contract}.ts; docs/CONTRACT.md is the human-readable form.
 */
router.get("/contract", (_req, res) => {
  res.json({ version: CONTRACT_VERSION, schema: BROKER_CONTRACT_SCHEMA });
});

export default router;
