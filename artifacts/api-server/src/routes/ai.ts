/**
 * AI-assist endpoints — GET /api/ai/status (which provider is wired) and POST
 * /api/ai/chat (proxy a chat completion to the configured model). Thin shell; the
 * provider plumbing (Ollama/OpenRouter/OpenAI/Anthropic) lives in lib/ai.
 */
import { Router, type Request, type Response } from "express";
import { aiStatus, aiChat, AiError, type ChatMessage } from "../lib/ai";
import { getSettings } from "../lib/settings";
import { getSession } from "./auth";
import { enforceCapability, CapabilityBlockedError, screenIdForRoute } from "../lib/capability-governance";
import { planAction } from "../lib/nl-action";
import { MCP_TOOLS } from "../lib/mcp";
import { isActionApproved, listApprovedVocab, approvalContextFromReq } from "../lib/approved-actions";
import { answerCopilot } from "../lib/copilot";
import { suggestBackendPrompt, parseSuggestedManifest, SuggestParseError } from "../lib/backend-suggest";
import { getBroker, contextFromReq } from "../broker";
import { hasRole, roleForReq, requireRole } from "../lib/rbac";
import { recordAudit, actorForAudit } from "../lib/audit";
import { aiGovernanceStatus, aiUsageReport, type AiGovContext } from "../lib/ai-governance";
import { aiContainmentLevel, aiSourceLevel } from "../lib/ai-containment";
import { transcribe, sttStatus, sttCapabilityId, SttError } from "../lib/stt";
import { v, parseOr400 } from "../lib/validate";

const router = Router();

// Zero-trust schemas for the hand-rolled AI bodies: every field is typed AND bounded, so a
// hostile/oversized payload is rejected with a 400 rather than narrowed by an `as` cast. The
// max-length caps double as a cheap DoS guard on otherwise-unbounded free text.
const CHAT_BODY = v.object({
  messages: v.array(
    v.object({ role: v.enum(["system", "user", "assistant"] as const), content: v.string({ max: 32_000 }) }),
    { min: 1, max: 100 },
  ),
});
const NL_ACTION_BODY = v.object({ text: v.string({ trim: true, min: 1, max: 8_000 }) });
const COPILOT_BODY = v.object({
  question: v.string({ trim: true, min: 1, max: 8_000 }),
  mode: v.optional(v.enum(["rag", "freeform"] as const)),
  methodology: v.optional(v.string({ trim: true, max: 120 })),
});
const TRANSCRIBE_BODY = v.object({
  audio: v.string({ min: 1, max: 20_000_000 }), // base64 audio; express json limit is the hard ceiling
  mime: v.optional(v.string({ max: 100 })),
});
const SUGGEST_BACKEND_BODY = v.object({
  vendorName: v.string({ trim: true, min: 1, max: 200 }),
  hint: v.optional(v.string({ trim: true, max: 2_000 })),
});

/** The actor identity for capability logging, from the request session (or null). */
function actorFromSession(req: Request): { sub: string; email?: string | undefined } | null {
  const s = getSession(req);
  return s ? { sub: s.sub, email: s.email } : null;
}

/** Normalise the client-sent surface (body.surface) to a registry screen id. */
function surfaceFromBody(req: Request): string | undefined {
  const s = (req.body as { surface?: unknown }).surface;
  return screenIdForRoute(typeof s === "string" ? s : undefined);
}

/** The AI-governance scope for this request: budget keyed by the user `sub`, allowlist by role.
 *  Both are no-ops unless AI_TOKEN_BUDGET / AI_MODEL_ALLOWLIST are configured. */
function govCtx(req: Request): AiGovContext {
  return { scope: getSession(req)?.sub, role: roleForReq(req) };
}

/** Enforce an AI capability for a route. On a governance block, send 403 with the given
 *  `label` prefix and return false (the caller returns); re-throw anything else. Collapses
 *  the identical try/catch the AI routes all repeated. */
function enforceOr403(req: Request, res: Response, capabilityId: string, opts: { surface?: string | undefined; label: string }): boolean {
  try {
    enforceCapability(capabilityId, { surface: opts.surface, actor: actorFromSession(req) });
    return true;
  } catch (err) {
    if (err instanceof CapabilityBlockedError) { res.status(403).json({ error: `${opts.label}: ${err.message}` }); return false; }
    throw err;
  }
}

/** Send the standard AI/STT error response: an AiError/SttError carries its own HTTP status, anything
 *  else is a 502; the error is logged with `logMsg` and `fallback` is the body when it has no message.
 *  Collapses the identical catch block every AI/STT route repeated. */
function respondAiError(req: Request, res: Response, err: unknown, fallback: string, logMsg: string): void {
  const status = err instanceof AiError || err instanceof SttError ? err.status : 502;
  req.log.error({ err }, logMsg);
  res.status(status).json({ error: err instanceof Error ? err.message : fallback });
}

// ── GET /api/ai/status — which provider/model is active and ready ─────────────
router.get("/ai/status", (_req, res) => {
  res.json(aiStatus());
});

// ── GET /api/ai/governance — the active AI-governance policy (admin; no secrets) ──
// DLP on/off, the per-role model allowlist, and the token-budget window.
router.get("/ai/governance", requireRole("admin"), (_req, res) => {
  res.json(aiGovernanceStatus());
});

// ── GET /api/ai/usage — per-scope token usage this window, for chargeback (admin) ──
router.get("/ai/usage", requireRole("admin"), async (_req, res) => {
  res.json({ window: aiGovernanceStatus().budget, usage: await aiUsageReport() });
});

// ── POST /api/ai/chat — route a chat completion to the selected provider ──────
router.post("/ai/chat", async (req, res) => {
  const parsed = parseOr400(req, res, CHAT_BODY);
  if (!parsed) return;
  const messages: ChatMessage[] = parsed.messages;

  // Strong, logged governance gate: the active AI provider must be permitted on the
  // calling surface (the client sends the current screen id). Denials are audited.
  const provider = getSettings().aiProvider;
  // The client sends its current route; normalise it to a registry screen id so
  // per-surface overrides match (an unknown route ⇒ the global state applies).
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;

  try {
    const result = await aiChat(messages, govCtx(req));
    res.json(result);
  } catch (err) {
    respondAiError(req, res, err, "AI request failed", "AI chat failed");
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
  const parsed = parseOr400(req, res, NL_ACTION_BODY);
  if (!parsed) return;
  const text = parsed.text;

  const provider = getSettings().aiProvider;
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;

  try {
    // Writes are only planned for a contributor+ caller; a viewer gets read actions only.
    const allowWrites = hasRole(req, "contributor");
    // Hard limit: the planner may only choose from the customer's APPROVED actions, evaluated
    // for THIS request's surface, role and active backend (the full per-scope matrix).
    const tools = MCP_TOOLS.filter((t) => isActionApproved(t.action, approvalContextFromReq(req, surface)));
    const plan = await planAction({ text, tools, allowWrites, complete: async (prompt) => (await aiChat([{ role: "user", content: prompt }], govCtx(req))).content });
    res.json({ plan });
  } catch (err) {
    respondAiError(req, res, err, "planning failed", "nl-action planning failed");
  }
});

// ── POST /api/ai/copilot — read-only NL Q&A over the scoped portfolio read model ──
// Never writes, exposes no actions to the model, and sends only a minimal aggregated
// snapshot (egress-scoped + injection-hardened in lib/copilot). Governance-gated.
router.post("/ai/copilot", async (req, res) => {
  const parsed = parseOr400(req, res, COPILOT_BODY);
  if (!parsed) return;
  const question = parsed.question;

  const provider = getSettings().aiProvider;
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;

  // Retrieval mode: "rag" (default) lenses the answer through a methodology persona;
  // "freeform" answers plainly. An optional methodology hint pins which lens RAG picks.
  const mode: "rag" | "freeform" = parsed.mode ?? "rag";
  const methodology = parsed.methodology;
  try {
    const result = await answerCopilot({
      question,
      broker: getBroker(),
      ctx: contextFromReq(req),
      vocab: listApprovedVocab(), // ask the model to use the customer's approved terminology
      mode,
      ...(methodology ? { methodology } : {}),
      complete: async (messages) => (await aiChat(messages, govCtx(req))).content,
    });
    res.json(result);
  } catch (err) {
    respondAiError(req, res, err, "copilot failed", "copilot failed");
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
  const parsed = parseOr400(req, res, TRANSCRIBE_BODY);
  if (!parsed) return;

  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, sttCapabilityId(), { surface, label: "Speech-to-text is unavailable here" })) return;

  try {
    const audio = Buffer.from(parsed.audio, "base64");
    const result = await transcribe(audio, parsed.mime ?? "audio/webm");
    res.json(result);
  } catch (err) {
    respondAiError(req, res, err, "transcription failed", "transcription failed");
  }
});

// ── POST /api/ai/suggest-backend — draft a starting-point backend definition ──
// Admin-only (same audience as Settings → Custom backends) and gated by its own
// capability (off by default) on top of the shared provider gate. Returns a plain
// manifest-shaped object with no "actions" — the SPA loads it through the exact
// same parseBackendFile()/toDraft() path an uploaded file already takes, and an
// admin still maps every action by hand.
router.post("/ai/suggest-backend", requireRole("admin"), async (req, res) => {
  const parsed = parseOr400(req, res, SUGGEST_BACKEND_BODY);
  if (!parsed) return;

  const provider = getSettings().aiProvider;
  const surface = surfaceFromBody(req);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;
  if (!enforceOr403(req, res, "backend-draft", { surface, label: "AI backend drafting is unavailable here" })) return;

  try {
    const prompt = suggestBackendPrompt(parsed.vendorName, parsed.hint);
    const { content } = await aiChat([{ role: "user", content: prompt }], govCtx(req));
    const manifest = parseSuggestedManifest(content, parsed.vendorName);
    recordAudit({
      ts: new Date().toISOString(),
      category: "admin",
      action: "ai.backend_draft_suggested",
      actor: actorForAudit(req),
      write: false,
      meta: { vendorName: parsed.vendorName },
    });
    res.json({ manifest });
  } catch (err) {
    if (err instanceof SuggestParseError) { res.status(502).json({ error: err.message }); return; }
    respondAiError(req, res, err, "suggestion failed", "backend-draft suggestion failed");
  }
});

export default router;
