import { Router } from "express";
import { deploymentTypeCatalogue, getDeploymentType, resolveDeploymentSetup } from "@workspace/backend-catalogue";

/**
 * DEPLOYMENT TYPES — the on-ramp archetypes (solo self-hoster, small team, managed cloud, enterprise
 * on-prem, regulated self-host). A user picks a type, answers a few questions, and gets a known-good setup.
 * Modelled on the methodology catalogue; the catalogue + resolver are pure (backend-catalogue), so these are
 * thin read/resolve endpoints.
 *
 *  - GET  /api/deployment-types            — the pickable list (label + description + questions).
 *  - GET  /api/deployment-types/:id        — one type (with its questions).
 *  - POST /api/deployment-types/:id/resolve — body `{ answers }` → the resolved known-good setup.
 */
const router = Router();

router.get("/deployment-types", (_req, res) => {
  res.json({ deploymentTypes: deploymentTypeCatalogue() });
});

router.get("/deployment-types/:id", (req, res) => {
  const type = getDeploymentType(String((req.params as { id?: unknown }).id ?? ""));
  if (!type) { res.status(404).json({ error: "unknown deployment type" }); return; }
  res.json(type);
});

router.post("/deployment-types/:id/resolve", (req, res) => {
  const id = String((req.params as { id?: unknown }).id ?? "");
  const body = (req.body ?? {}) as { answers?: unknown };
  // Only string→string answers are honoured; anything else is dropped (the resolver defaults it).
  const answers: Record<string, string> = {};
  if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) if (typeof v === "string") answers[k] = v;
  }
  const resolved = resolveDeploymentSetup(id, answers);
  if (!resolved) { res.status(404).json({ error: "unknown deployment type" }); return; }
  res.json(resolved);
});

export default router;
