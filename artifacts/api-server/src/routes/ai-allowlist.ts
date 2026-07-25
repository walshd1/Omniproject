import { Router } from "express";
import { requireArtifactStore } from "../lib/artifact-store";
import { SettingsValidationError } from "../lib/settings";
import {
  resolveAiProviderAllowlist, sanitizeAiProviderAllowlist, writeOrgAiProviderAllowlist,
  resolveAiModelAllowlist, sanitizeAiModelAllowlist, writeOrgAiModelAllowlist,
  resolveSttProviderAllowlist, sanitizeSttProviderAllowlist, writeOrgSttProviderAllowlist,
} from "../lib/ai-allowlist";
import { captureVersion } from "../lib/config-store";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

/**
 * AI SELECTION ALLOWLISTS — the org's governance FLOORS over which AI providers / models / STT engines may be
 * selected (roadmap Phase C). `null` = unrestricted. A lower scope (programme/project) can only NARROW the org
 * ceiling further, via its own imported config def — never widen it. The SELECTION gate (rejecting a
 * `PATCH /settings` that picks a forbidden value) lives in routes/settings.
 *
 * Each allowlist is a GET the floor-resolved set (any authed user; the pickers read it) + a PUT of the ORG
 * ceiling (admin).
 *
 * LANE 2: the three PUTs are org-config governance verbs, each its own mountCommand descriptor. The write
 * shell (parse gate → run → ruleset → audit) is shared via `allowlistPut` — but the method/path/role stay
 * LITERAL on each descriptor so the static route generator can read them (a factory with a variable path hid
 * these six routes from API-REFERENCE entirely; explicit descriptors + explicit GETs surface them). The
 * sealed-store precondition and the sanitise-or-400 validation are the parse gate; the action base now records
 * a success audit each PUT lacked — additive, no-op under default config.
 */
const router = Router();

type AllowlistArgs = { value: string[] | null };

/** The shared write shell for one allowlist PUT (parse gate + effect), keyed on the body/reply property. */
function allowlistPut(
  key: string, versionLabel: string,
  resolve: () => string[] | null, sanitize: (v: unknown) => string[] | null, writeOrg: (v: string[] | null) => void,
): Pick<CommandDescriptor<AllowlistArgs>, "parse" | "run"> {
  return {
    parse: (req, res) => {
      if (!requireArtifactStore(res)) return null;
      try { return { value: sanitize((req.body as Record<string, unknown> | undefined)?.[key]) }; }
      catch (err) { res.status(400).json({ error: err instanceof SettingsValidationError ? err.message : "invalid allowlist" }); return null; }
    },
    run: async (_req, _res, { value }) => {
      writeOrg(value);
      captureVersion(versionLabel);
      return { [key]: resolve() };
    },
  };
}

router.get("/ai/provider-allowlist", (_req, res) => { res.json({ aiProviderAllowlist: resolveAiProviderAllowlist() }); });
export const aiProviderAllowlistCommand: CommandDescriptor<AllowlistArgs> = {
  name: "ai-provider-allowlist.save",
  method: "put",
  path: "/ai/provider-allowlist",
  role: "admin",
  ...allowlistPut("aiProviderAllowlist", "AI provider allowlist updated", resolveAiProviderAllowlist, sanitizeAiProviderAllowlist, writeOrgAiProviderAllowlist),
  audit: "ai-provider-allowlist.save",
  auditCategory: "admin",
};
mountCommand(router, aiProviderAllowlistCommand);

router.get("/ai/model-allowlist", (_req, res) => { res.json({ aiModelAllowlist: resolveAiModelAllowlist() }); });
export const aiModelAllowlistCommand: CommandDescriptor<AllowlistArgs> = {
  name: "ai-model-allowlist.save",
  method: "put",
  path: "/ai/model-allowlist",
  role: "admin",
  ...allowlistPut("aiModelAllowlist", "AI model allowlist updated", resolveAiModelAllowlist, sanitizeAiModelAllowlist, writeOrgAiModelAllowlist),
  audit: "ai-model-allowlist.save",
  auditCategory: "admin",
};
mountCommand(router, aiModelAllowlistCommand);

router.get("/ai/stt-provider-allowlist", (_req, res) => { res.json({ sttProviderAllowlist: resolveSttProviderAllowlist() }); });
export const sttProviderAllowlistCommand: CommandDescriptor<AllowlistArgs> = {
  name: "stt-provider-allowlist.save",
  method: "put",
  path: "/ai/stt-provider-allowlist",
  role: "admin",
  ...allowlistPut("sttProviderAllowlist", "STT provider allowlist updated", resolveSttProviderAllowlist, sanitizeSttProviderAllowlist, writeOrgSttProviderAllowlist),
  audit: "stt-provider-allowlist.save",
  auditCategory: "admin",
};
mountCommand(router, sttProviderAllowlistCommand);

export default router;
