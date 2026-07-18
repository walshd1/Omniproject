import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { SettingsValidationError } from "../lib/settings";
import { resolveAiProviderAllowlist, sanitizeAiProviderAllowlist, writeOrgAiProviderAllowlist } from "../lib/ai-allowlist";
import { captureVersion } from "../lib/config-store";

/**
 * AI PROVIDER ALLOWLIST — the org's governance FLOOR over which AI providers may be selected (roadmap Phase C).
 * `null` = unrestricted. A lower scope (programme/project) can only NARROW the org ceiling further, via its own
 * imported `ai-provider-allowlist` config def — never widen it. The SELECTION gate (rejecting a `PATCH /settings`
 * that picks a forbidden `aiProvider`) is enforced in routes/settings.
 *
 *  - GET /api/ai/provider-allowlist — the floor-resolved allowed set (any authed user; the provider picker reads it).
 *  - PUT /api/ai/provider-allowlist — set the ORG ceiling (admin). Body: `{ aiProviderAllowlist: string[] | null }`.
 */
const router = Router();

router.get("/ai/provider-allowlist", (_req, res) => {
  res.json({ aiProviderAllowlist: resolveAiProviderAllowlist() });
});

router.put("/ai/provider-allowlist", requireRole("admin"), (req, res) => {
  if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
  let value: string[] | null;
  try { value = sanitizeAiProviderAllowlist((req.body as { aiProviderAllowlist?: unknown } | undefined)?.aiProviderAllowlist); }
  catch (err) { res.status(400).json({ error: err instanceof SettingsValidationError ? err.message : "invalid AI provider allowlist" }); return; }
  writeOrgAiProviderAllowlist(value);
  captureVersion("AI provider allowlist updated");
  res.json({ aiProviderAllowlist: resolveAiProviderAllowlist() });
});

export default router;
