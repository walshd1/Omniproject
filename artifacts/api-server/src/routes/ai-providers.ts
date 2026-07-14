import { Router, type Request } from "express";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { recordRequestAudit } from "../lib/audit";
import { assertSafeIdentifier } from "../lib/payload-guard";
import { assertSafeOutboundUrl } from "../lib/url-safety";
import {
  AI_PROVIDER_KINDS, AI_CAPABILITIES,
  listProviders, upsertProvider, removeProvider,
  setProviderKey, clearProviderKey, providerKeyState,
  setCapabilityProviders, providersSnapshot,
  rollbackAiProviders, canRollbackAiProviders,
} from "../lib/ai-providers";
import { vaultBackendId, VAULT_BACKENDS } from "../lib/vault-store";
import { kmsProvider, kmsEnabled } from "../lib/kms";
import { v, parseOr400 } from "../lib/validate";

// Typed + bounded schemas for the admin write bodies (untrusted boundary input).
const PROVIDER_BODY = v.object({
  id: v.string({ trim: true, min: 1, max: 80 }),
  kind: v.enum(AI_PROVIDER_KINDS),
  label: v.string({ trim: true, min: 1, max: 120 }),
  endpoint: v.optional(v.string({ trim: true, max: 2_000 })),
  model: v.optional(v.string({ trim: true, max: 200 })),
});
const KEY_BODY = v.object({ key: v.string({ trim: true, min: 1, max: 8_000 }) });
const CAP_BODY = v.object({ providers: v.array(v.string({ trim: true, min: 1, max: 80 }), { max: 50 }) });

/**
 * AI Providers admin plane. Providers are first-class entities; their API keys go into the
 * encrypted vault (write-only — a key is NEVER returned, only presence + a fingerprint).
 * Capabilities map to an ORDERED list of providers. All writes are admin + step-up + audited.
 */
const router = Router();

function audit(req: Request, action: string, meta?: Record<string, unknown>): void {
  recordRequestAudit(req, { category: "admin", action, write: true, result: "success", meta });
}

// ── GET /api/ai/providers — the registry + capability map (no secrets) ──────────
router.get("/ai/providers", requireRole("admin"), (_req, res) => {
  res.json({
    ...providersSnapshot(),
    kinds: AI_PROVIDER_KINDS,
    capabilities: AI_CAPABILITIES,
    vault: { backend: vaultBackendId(), backends: VAULT_BACKENDS, kms: kmsEnabled() ? kmsProvider() : "none" },
  });
});

// One-generation undo for the last provider/mapping change — same admin + step-up gate as the
// writes it reverses. Never restores a deleted/rotated KEY (those live in the vault, out of
// scope for this undo — see lib/ai-providers.ts).
router.get("/ai/providers/rollback", requireRole("admin"), (_req, res) => {
  res.json({ available: canRollbackAiProviders() });
});

router.post("/ai/providers/rollback", requireRole("admin"), requireStepUp, (req, res) => {
  const rolledBack = rollbackAiProviders();
  audit(req, "ai-provider.rollback", { rolledBack });
  res.json({ rolledBack, ...providersSnapshot() });
});

// ── POST /api/ai/providers — add / update a provider entity (admin + step-up) ───
router.post("/ai/providers", requireRole("admin"), requireStepUp, (req, res) => {
  const parsed = parseOr400(req, res, PROVIDER_BODY);
  if (!parsed) return;
  const { id, kind, label } = parsed;
  try {
    assertSafeIdentifier("id", id); // ids ride into vault refs + file keys — keep them safe
  } catch {
    res.status(400).json({ error: "id contains unsafe characters." });
    return;
  }
  const endpoint = parsed.endpoint || undefined;
  if (endpoint) {
    // The endpoint is fetched server-side (lib/ai, lib/stt), so a metadata/link-local URL would
    // be an SSRF sink — reject it at the write boundary, not just at call time.
    try {
      assertSafeOutboundUrl(endpoint, "endpoint");
    } catch {
      res.status(400).json({ error: "endpoint is not a valid or safe http(s) URL." });
      return;
    }
  }
  const model = parsed.model || undefined;
  upsertProvider({ id, kind, label, ...(endpoint ? { endpoint } : {}), ...(model ? { model } : {}) });
  audit(req, "ai-provider.upsert", { id, kind });
  res.json({ ok: true, providers: providersSnapshot().providers });
});

// ── DELETE /api/ai/providers/:id — remove an entity + its key (admin + step-up) ─
router.delete("/ai/providers/:id", requireRole("admin"), requireStepUp, async (req, res) => {
  const id = String(req.params["id"]);
  await removeProvider(id);
  audit(req, "ai-provider.remove", { id });
  res.json({ ok: true, providers: providersSnapshot().providers });
});

// ── PUT /api/ai/providers/:id/key — store an API key in the vault (write-only) ──
// The key goes straight into the encrypted vault; the response NEVER echoes it, only the
// resulting presence + fingerprint so the admin can confirm the paste landed.
router.put("/ai/providers/:id/key", requireRole("admin"), requireStepUp, async (req, res) => {
  const id = String(req.params["id"]);
  if (!listProviders().some((p) => p.id === id)) { res.status(404).json({ error: "Unknown provider." }); return; }
  const parsed = parseOr400(req, res, KEY_BODY);
  if (!parsed) return;
  try {
    await setProviderKey(id, parsed.key); // awaited so an external-store failure surfaces
  } catch (err) {
    req.log.error({ err }, "vault: storing provider key failed");
    res.status(502).json({ error: "Could not store the key in the secrets backend." });
    return;
  }
  audit(req, "ai-provider.key.set", { id }); // never logs the key itself
  res.json(providerKeyState(id));
});

// ── DELETE /api/ai/providers/:id/key — remove a stored key (admin + step-up) ────
router.delete("/ai/providers/:id/key", requireRole("admin"), requireStepUp, async (req, res) => {
  const id = String(req.params["id"]);
  try {
    await clearProviderKey(id);
  } catch (err) {
    req.log.error({ err }, "vault: clearing provider key failed");
    res.status(502).json({ error: "Could not remove the key from the secrets backend." });
    return;
  }
  audit(req, "ai-provider.key.clear", { id });
  res.json(providerKeyState(id));
});

// ── PUT /api/ai/capabilities/:cap — set the ordered provider list (admin + step-up) ──
router.put("/ai/capabilities/:cap", requireRole("admin"), requireStepUp, (req, res) => {
  const cap = String(req.params["cap"]);
  if (!AI_CAPABILITIES.some((c) => c.id === cap)) { res.status(404).json({ error: "Unknown capability." }); return; }
  const parsed = parseOr400(req, res, CAP_BODY);
  if (!parsed) return;
  const providers = parsed.providers;
  setCapabilityProviders(cap, providers);
  audit(req, "ai-provider.mapping.set", { cap, providers });
  res.json({ ok: true, mapping: providersSnapshot().mapping });
});

export default router;
