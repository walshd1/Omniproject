/**
 * AI-assist endpoints — GET /api/ai/status (which provider is wired) and POST
 * /api/ai/chat (proxy a chat completion to the configured model). Thin shell; the
 * provider plumbing (Ollama/OpenRouter/OpenAI/Anthropic) lives in lib/ai.
 */
import { Router } from "express";
import { aiStatus, aiChat, AiError, type ChatMessage } from "../lib/ai";
import { getSettings } from "../lib/settings";
import { getSession } from "./auth";
import { enforceCapability, CapabilityBlockedError, screenIdForRoute } from "../lib/tools";
import { planAction } from "../lib/nl-action";
import { hasRole } from "../lib/rbac";
import { aiContainmentLevel, aiSourceLevel } from "../lib/ai-containment";

const router = Router();

const VALID_ROLES = new Set(["system", "user", "assistant"]);

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (typeof role !== "string" || !VALID_ROLES.has(role) || typeof content !== "string") return null;
    messages.push({ role: role as ChatMessage["role"], content });
  }
  return messages;
}

// ── GET /api/ai/status — which provider/model is active and ready ─────────────
router.get("/ai/status", (_req, res) => {
  res.json(aiStatus());
});

// ── POST /api/ai/chat — route a chat completion to the selected provider ──────
router.post("/ai/chat", async (req, res) => {
  const messages = parseMessages(req.body);
  if (!messages) {
    res.status(400).json({ error: "Body must be { messages: [{ role, content }] }." });
    return;
  }

  // Strong, logged governance gate: the active AI provider must be permitted on the
  // calling surface (the client sends the current screen id). Denials are audited.
  const provider = getSettings().aiProvider;
  // The client sends its current route; normalise it to a registry screen id so
  // per-surface overrides match (an unknown route ⇒ the global state applies).
  const surface = screenIdForRoute(typeof (req.body as { surface?: unknown }).surface === "string" ? (req.body as { surface: string }).surface : undefined);
  const session = getSession(req);
  try {
    enforceCapability(`provider:${provider}`, { surface, actor: session ? { sub: session.sub, email: session.email } : null });
  } catch (err) {
    if (err instanceof CapabilityBlockedError) { res.status(403).json({ error: `AI is unavailable here: ${err.message}` }); return; }
    throw err;
  }

  try {
    const result = await aiChat(messages);
    res.json(result);
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    req.log.error({ err }, "AI chat failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "AI request failed" });
  }
});

// ── GET /api/ai/containment — the current AI exposure level (for every AI surface) ──
// Non-sensitive: lets any AI-tool surface show the "leash" (how constrained autonomous
// AI behaviour is right now) alongside the feature.
router.get("/ai/containment", (req, res) => {
  const surface = screenIdForRoute(typeof req.query["surface"] === "string" ? req.query["surface"] : undefined);
  res.json({ level: aiContainmentLevel(surface), source: aiSourceLevel(surface) });
});

// ── POST /api/ai/nl-action — map a natural-language instruction to a canonical action ──
// PLANS only; never executes. Writes are surfaced (write:true) for the SPA to confirm,
// and only offered when the caller is a contributor+ (a viewer is never shown a mutation).
router.post("/ai/nl-action", async (req, res) => {
  const text = typeof (req.body as { text?: unknown }).text === "string" ? (req.body as { text: string }).text : "";
  if (!text.trim()) { res.status(400).json({ error: "Body must be { text }." }); return; }

  const provider = getSettings().aiProvider;
  const surface = screenIdForRoute(typeof (req.body as { surface?: unknown }).surface === "string" ? (req.body as { surface: string }).surface : undefined);
  const session = getSession(req);
  try {
    enforceCapability(`provider:${provider}`, { surface, actor: session ? { sub: session.sub, email: session.email } : null });
  } catch (err) {
    if (err instanceof CapabilityBlockedError) { res.status(403).json({ error: `AI is unavailable here: ${err.message}` }); return; }
    throw err;
  }

  try {
    // Writes are only planned for a contributor+ caller; a viewer gets read actions only.
    const allowWrites = hasRole(req, "contributor");
    const plan = await planAction({ text, allowWrites, complete: async (prompt) => (await aiChat([{ role: "user", content: prompt }])).content });
    res.json({ plan });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    req.log.error({ err }, "nl-action planning failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "planning failed" });
  }
});

export default router;
