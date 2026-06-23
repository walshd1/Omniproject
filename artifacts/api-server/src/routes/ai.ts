import { Router } from "express";
import { aiStatus, aiChat, AiError, type ChatMessage } from "../lib/ai";

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

  try {
    const result = await aiChat(messages);
    res.json(result);
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    req.log.error({ err }, "AI chat failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "AI request failed" });
  }
});

export default router;
