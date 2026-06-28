import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { recordAudit } from "../lib/audit";
import { getSession } from "./auth";
import { assertSafeIdentifier } from "../lib/payload-guard";
import {
  AI_PROVIDER_KINDS, AI_CAPABILITIES, type AiProviderKind,
  listProviders, upsertProvider, removeProvider,
  setProviderKey, clearProviderKey, providerKeyState,
  setCapabilityProviders, providersSnapshot,
} from "../lib/ai-providers";
import { vaultBackendId, VAULT_BACKENDS } from "../lib/vault-store";

/**
 * AI Providers admin plane. Providers are first-class entities; their API keys go into the
 * encrypted vault (write-only — a key is NEVER returned, only presence + a fingerprint).
 * Capabilities map to an ORDERED list of providers. All writes are admin + step-up + audited.
 */
const router = Router();

function actor(req: Parameters<typeof getSession>[0]) {
  const s = getSession(req);
  return s ? { sub: s.sub, email: s.email } : null;
}

function audit(req: Parameters<typeof getSession>[0], action: string, meta?: Record<string, unknown>): void {
  recordAudit({ ts: new Date().toISOString(), category: "admin", action, actor: actor(req), write: true, result: "success", meta });
}

// ── GET /api/ai/providers — the registry + capability map (no secrets) ──────────
router.get("/ai/providers", requireRole("admin"), (_req, res) => {
  res.json({
    ...providersSnapshot(),
    kinds: AI_PROVIDER_KINDS,
    capabilities: AI_CAPABILITIES,
    vault: { backend: vaultBackendId(), backends: VAULT_BACKENDS },
  });
});

// ── POST /api/ai/providers — add / update a provider entity (admin + step-up) ───
router.post("/ai/providers", requireRole("admin"), requireStepUp, (req, res) => {
  const body = (req.body ?? {}) as { id?: unknown; kind?: unknown; label?: unknown; endpoint?: unknown; model?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const kind = body.kind as AiProviderKind;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!id || !label) { res.status(400).json({ error: "Body must be { id, kind, label, endpoint?, model? }." }); return; }
  if (!AI_PROVIDER_KINDS.includes(kind)) { res.status(400).json({ error: `kind must be one of: ${AI_PROVIDER_KINDS.join(", ")}.` }); return; }
  try {
    assertSafeIdentifier("id", id); // ids ride into vault refs + file keys — keep them safe
  } catch {
    res.status(400).json({ error: "id contains unsafe characters." });
    return;
  }
  const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : undefined;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
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
  const key = typeof (req.body as { key?: unknown }).key === "string" ? (req.body as { key: string }).key.trim() : "";
  if (!key) { res.status(400).json({ error: "Body must be { key }." }); return; }
  try {
    await setProviderKey(id, key); // awaited so an external-store failure surfaces
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
  const providers = (req.body as { providers?: unknown }).providers;
  if (!Array.isArray(providers) || providers.some((p) => typeof p !== "string")) {
    res.status(400).json({ error: "Body must be { providers: string[] }." });
    return;
  }
  setCapabilityProviders(cap, providers as string[]);
  audit(req, "ai-provider.mapping.set", { cap, providers });
  res.json({ ok: true, mapping: providersSnapshot().mapping });
});

export default router;
