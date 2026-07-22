import { Router, type Request, type Response } from "express";
import { aiStatus, aiChat, AiError } from "../lib/ai";
import { getSettings } from "../lib/settings";
import { getSession } from "./auth";
import { enforceCapability, CapabilityBlockedError, screenIdForRoute } from "../lib/capability-governance";
import { grantedCapabilitiesForReq } from "../lib/custom-roles";
import { roleForReq, requireRole } from "../lib/rbac";
import { recordRequestAudit } from "../lib/audit";
import { type AiGovContext } from "../lib/ai-governance";
import { v, parseOr400 } from "../lib/validate";
import { generatePrimitiveBundle, PrimitiveStudioParseError } from "../lib/primitive-studio";

/**
 * PRIMITIVE STUDIO routes — the AI authoring "skill" (roadmap X.2), behind the default-off `studio` module.
 * POST /studio/primitive turns a description into a candidate primitive bundle + validates it, so the SPA
 * studio can render it back and iterate. It only GENERATES + TESTS; the write goes through the normal
 * registry submit path once the user is happy. Governed like every AI surface: the active provider capability
 * + the `ai-authoring` capability (both off by default) + contributor role.
 */
const router = Router();

const STUDIO_PROMPT_MAX = 4_000;
const STUDIO_IMAGE_MAX = 6_000_000; // ~4.5 MB decoded; bounded well under the express json limit
const PRIMITIVE_BODY = v.object({
  description: v.string({ trim: true, min: 1, max: STUDIO_PROMPT_MAX }),
  feedback: v.optional(v.string({ trim: true, max: STUDIO_PROMPT_MAX })),
  surface: v.optional(v.string({ max: 200 })),
  image: v.optional(v.object({
    mime: v.enum(["image/png", "image/jpeg", "image/webp", "image/gif"] as const),
    dataBase64: v.string({ min: 1, max: STUDIO_IMAGE_MAX }),
  })),
});

/** The previous attempt's payload, echoed back for an iteration — a plain object or nothing. Bounded by the
 *  express JSON body limit; only ever fed back into the prompt. */
function previousPayload(req: Request): Record<string, unknown> | undefined {
  const p = (req.body as { previous?: unknown }).previous;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : undefined;
}

function actorFromSession(req: Request): { sub: string; email?: string | undefined } | null {
  const s = getSession(req);
  return s ? { sub: s.sub, email: s.email } : null;
}
function govCtx(req: Request): AiGovContext {
  return { scope: getSession(req)?.sub, role: roleForReq(req) };
}
function enforceOr403(req: Request, res: Response, capabilityId: string, opts: { surface?: string | undefined; label: string }): boolean {
  try {
    enforceCapability(capabilityId, { surface: opts.surface, actor: actorFromSession(req), granted: grantedCapabilitiesForReq(req) });
    return true;
  } catch (err) {
    if (err instanceof CapabilityBlockedError) { res.status(403).json({ error: `${opts.label}: ${err.message}` }); return false; }
    throw err;
  }
}

// GET /api/studio/status — whether an AI provider is configured (the studio needs one). No secrets.
router.get("/studio/status", requireRole("contributor"), (_req, res) => {
  const s = aiStatus();
  res.json({ available: s.configured });
});

// POST /api/studio/primitive — generate + validate a candidate primitive from a description (contributor+).
router.post("/studio/primitive", requireRole("contributor"), async (req, res) => {
  const parsed = parseOr400(req, res, PRIMITIVE_BODY);
  if (!parsed) return;

  const provider = getSettings().aiProvider;
  const surface = screenIdForRoute(parsed.surface);
  if (!enforceOr403(req, res, `provider:${provider}`, { surface, label: "AI is unavailable here" })) return;
  if (!enforceOr403(req, res, "ai-authoring", { surface, label: "AI primitive authoring is unavailable here" })) return;

  try {
    const previous = previousPayload(req);
    const result = await generatePrimitiveBundle(
      {
        description: parsed.description,
        ...(parsed.feedback ? { feedback: parsed.feedback } : {}),
        ...(previous ? { previous } : {}),
        ...(parsed.image ? { image: parsed.image } : {}),
      },
      async (messages) => (await aiChat(messages, govCtx(req))).content,
    );
    recordRequestAudit(req, { category: "request", action: "studio.primitive_generated", write: false, meta: { valid: result.valid, withImage: !!parsed.image } });
    res.json({ result });
  } catch (err) {
    if (err instanceof PrimitiveStudioParseError) { res.status(502).json({ error: err.message }); return; }
    const status = err instanceof AiError ? err.status : 502;
    req.log.error({ err }, "studio primitive generation failed");
    res.status(status).json({ error: err instanceof Error ? err.message : "generation failed" });
  }
});

export default router;
