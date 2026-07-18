import { Router, type RequestHandler } from "express";
import { requireRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { SettingsValidationError } from "../lib/settings";
import {
  resolveAiProviderAllowlist, sanitizeAiProviderAllowlist, writeOrgAiProviderAllowlist,
  resolveAiModelAllowlist, sanitizeAiModelAllowlist, writeOrgAiModelAllowlist,
  resolveSttProviderAllowlist, sanitizeSttProviderAllowlist, writeOrgSttProviderAllowlist,
} from "../lib/ai-allowlist";
import { captureVersion } from "../lib/config-store";

/**
 * AI SELECTION ALLOWLISTS — the org's governance FLOORS over which AI providers / models / STT engines may be
 * selected (roadmap Phase C). `null` = unrestricted. A lower scope (programme/project) can only NARROW the org
 * ceiling further, via its own imported config def — never widen it. The SELECTION gate (rejecting a
 * `PATCH /settings` that picks a forbidden value) lives in routes/settings.
 *
 * Each pair: GET the floor-resolved set (any authed user; the pickers read it), PUT the ORG ceiling (admin).
 */
const router = Router();

/** Build the GET + PUT pair for one allowlist. `key` is the JSON property on the body/reply. */
function allowlistRoutes(
  path: string, key: string, versionLabel: string,
  resolve: () => string[] | null, sanitize: (v: unknown) => string[] | null, writeOrg: (v: string[] | null) => void,
): void {
  router.get(path, (_req, res) => { res.json({ [key]: resolve() }); });
  const put: RequestHandler = (req, res) => {
    if (!requireArtifactStore(res)) return;
    let value: string[] | null;
    try { value = sanitize((req.body as Record<string, unknown> | undefined)?.[key]); }
    catch (err) { res.status(400).json({ error: err instanceof SettingsValidationError ? err.message : "invalid allowlist" }); return; }
    writeOrg(value);
    captureVersion(versionLabel);
    res.json({ [key]: resolve() });
  };
  router.put(path, requireRole("admin"), put);
}

allowlistRoutes("/ai/provider-allowlist", "aiProviderAllowlist", "AI provider allowlist updated", resolveAiProviderAllowlist, sanitizeAiProviderAllowlist, writeOrgAiProviderAllowlist);
allowlistRoutes("/ai/model-allowlist", "aiModelAllowlist", "AI model allowlist updated", resolveAiModelAllowlist, sanitizeAiModelAllowlist, writeOrgAiModelAllowlist);
allowlistRoutes("/ai/stt-provider-allowlist", "sttProviderAllowlist", "STT provider allowlist updated", resolveSttProviderAllowlist, sanitizeSttProviderAllowlist, writeOrgSttProviderAllowlist);

export default router;
