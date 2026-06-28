/**
 * AI-assist endpoints — GET /api/ai/status (which provider is wired) and POST
 * /api/ai/chat (proxy a chat completion to the configured model). Thin shell; the
 * provider plumbing (Ollama/OpenRouter/OpenAI/Anthropic) lives in lib/ai.
 */
import { Router, type Request, type Response } from "express";
import { aiStatus, aiChat, AiError, type ChatMessage } from "../lib/ai";
import { getSettings } from "../lib/settings";
import { getSession } from "./auth";
import { enforceCapability, CapabilityBlockedError, screenIdForRoute } from "../lib/tools";
import { planAction } from "../lib/nl-action";
import { MCP_TOOLS } from "../lib/mcp";
import { isActionApproved, listApprovedVocab, approvalContextFromReq } from "../lib/approved-actions";
import { answerCopilot } from "../lib/copilot";
import { getBroker, contextFromReq } from "../broker";
import { hasRole } from "../lib/rbac";
import { aiContainmentLevel, aiSourceLevel } from "../lib/ai-containment";
import { transcribe, sttStatus, sttCapabilityId, SttError } from "../lib/stt";

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

/** The actor identity for capability logging, from the request session (or null). */
function actorFromSession(req: Request): { sub: string; email?: string } | null {
  const s = getSession(req);
  return s ? { sub: s.sub, email: s.email } : null;
}

/** Normalise the client-sent surface (body.surface) to a registry screen id. */
function surfaceFromBody(req: Request): string | undefined {
  const s = (req.body as { surface?: unknown }).surface;
  return screenIdForRoute(typeof s === "string" ? s : undefined);
}

/** Enforce an AI capability for a route. On a governance block, send 403 with the given
 *  `label` prefix and return false (the caller returns); re-throw anything else. Collapses
 *  the identical try/catch the AI routes all repeated. */
function enforceOr403(req: Request, res: Response, capabilityId: string, opts: { surface?: string; label: string }): boolean {
  try {
    enforceCapability(capabilityId, { surface: opts.surface, actor: actorFromSession(req) });
    return true;
  } catch (err) {
    if (err instanceof CapabilityBlockedError) { res.status(403).json({ error: `${opts.label}: ${err.message}` }); return false; }
    throw err;
  }
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
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;

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
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;

  try {
    // Writes are only planned for a contributor+ caller; a viewer gets read actions only.
    const allowWrites = hasRole(req, "contributor");
    // Hard limit: the planner may only choose from the customer's APPROVED actions, evaluated
    // for THIS request's surface, role and active backend (the full per-scope matrix).
    const tools = MCP_TOOLS.filter((t) => isActionApproved(t.action, approvalContextFromReq(req, surface)));
    const plan = await planAction({ text, tools, allowWrites, complete: async (prompt) => (await aiChat([{ role: "user", content: prompt }])).content });
    res.json({ plan });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    req.log.error({ err }, "nl-action planning failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "planning failed" });
  }
});

// ── POST /api/ai/copilot — read-only NL Q&A over the scoped portfolio read model ──
// Never writes, exposes no actions to the model, and sends only a minimal aggregated
// snapshot (egress-scoped + injection-hardened in lib/copilot). Governance-gated.
router.post("/ai/copilot", async (req, res) => {
  const question = typeof (req.body as { question?: unknown }).question === "string" ? (req.body as { question: string }).question : "";
  if (!question.trim()) { res.status(400).json({ error: "Body must be { question }." }); return; }

  const provider = getSettings().aiProvider;
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;

  // Retrieval mode: "rag" (default) lenses the answer through a methodology persona;
  // "freeform" answers plainly. An optional methodology hint pins which lens RAG picks.
  const rawMode = (req.body as { mode?: unknown }).mode;
  const mode: "rag" | "freeform" = rawMode === "freeform" ? "freeform" : "rag";
  const methodology = typeof (req.body as { methodology?: unknown }).methodology === "string" ? (req.body as { methodology: string }).methodology : undefined;
  try {
    const result = await answerCopilot({
      question,
      broker: getBroker(),
      ctx: contextFromReq(req),
      vocab: listApprovedVocab(), // ask the model to use the customer's approved terminology
      mode,
      ...(methodology ? { methodology } : {}),
      complete: async (messages) => (await aiChat(messages)).content,
    });
    res.json(result);
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    req.log.error({ err }, "copilot failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "copilot failed" });
  }
});

// ── GET /api/ai/stt — which speech-to-text engine is active (and is it local?) ──
router.get("/ai/stt", (_req, res) => {
  res.json(sttStatus());
});

// ── POST /api/ai/transcribe — AI-assisted speech-to-text (Whisper et al) ──
// Only for off-device providers; the browser engine transcribes client-side. Governance-
// gated (the active stt:<provider> capability must be on for this surface) + kill-switch
// honoured. Body: { audio: base64, mime }.
router.post("/ai/transcribe", async (req, res) => {
  const body = (req.body ?? {}) as { audio?: unknown; mime?: unknown; surface?: unknown };
  if (typeof body.audio !== "string" || !body.audio) { res.status(400).json({ error: "Body must be { audio: base64, mime }." }); return; }

  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, sttCapabilityId(), { surface, label: "Speech-to-text is unavailable here" })) return;

  try {
    const audio = Buffer.from(body.audio, "base64");
    const result = await transcribe(audio, typeof body.mime === "string" ? body.mime : "audio/webm");
    res.json(result);
  } catch (err) {
    const status = err instanceof SttError ? err.status : 502;
    req.log.error({ err }, "transcription failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "transcription failed" });
  }
});

export default router;
