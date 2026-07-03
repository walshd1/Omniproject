import { extractJson } from "./nl-action";

/**
 * AI-drafted starting point for the backend/vendor authoring form (Settings →
 * Custom backends, `CustomBackendAdmin.tsx` in the SPA). Deliberately narrow: the
 * model has no live internet access and cannot verify anything against a real API,
 * so it's asked for only the parts a human can sanity-check at a glance (name, docs
 * link, auth style, which capability domains this kind of tool plausibly covers) —
 * never the `actions` (broker-expression URL/body mappings), where a hallucinated
 * but plausible-looking endpoint is genuinely risky if it slipped through unreviewed.
 * A human still maps every action by hand, same as authoring from scratch.
 *
 * The output is a plain manifest-shaped object — the SAME loose shape
 * `parseBackendFile`/`toDraft` (SPA `lib/backend-authoring.ts`) already accept from
 * an uploaded file, so the client can load it through that exact existing path
 * rather than a new one.
 */

/** Mirrors CAPABILITY_DOMAINS in the SPA's lib/backend-authoring.ts — kept in sync
 *  by hand like the other soft-duplicated capability lists in this codebase; a
 *  drift here only narrows which domains the model is offered, never validity
 *  (the schema the SPA validates against accepts any boolean capability key). */
const CAPABILITY_DOMAINS = [
  "issues", "scheduling", "resources", "financials", "portfolio", "baseline", "blockers", "history", "raid",
  "quality", "crm", "service", "benefits", "stakeholders", "raci",
] as const;

/** Build the model prompt for one vendor-draft request. `hint` is optional free text
 *  the requester supplied (e.g. a docs URL they already have). */
export function suggestBackendPrompt(vendorName: string, hint?: string): string {
  return [
    "You are drafting a STARTING-POINT backend definition for a project-management overlay's",
    "backend catalogue. You have NO live internet access and cannot verify anything against a",
    "real API — rely only on your training knowledge. A human will review and complete this",
    "draft before it's used, so if you're not confident about specifics, SAY SO in \"notes\"",
    "rather than inventing plausible-looking details.",
    "",
    "Reply with ONLY a single JSON object (no markdown fences, no commentary) with exactly",
    "these fields:",
    '  "id": kebab-case identifier derived from the name',
    '  "label": the product\'s display name',
    '  "docsUrl": its API/developer docs homepage if you\'re confident of the URL, else ""',
    '  "via": a short auth description, e.g. "REST API key" or "OAuth2"',
    '  "requiredEnv": array of plausible env var names a broker workflow would need (e.g. ["ACME_API_BASE"])',
    `  "capabilities": booleans for each of these domains — set true ONLY where you're`,
    `    confident this product's API actually exposes it: ${CAPABILITY_DOMAINS.join(", ")}`,
    '  "notes": MUST start with "AI-suggested, unverified — review before use." then add',
    "    anything you're unsure about or that a human should double check",
    "",
    'Do NOT include an "actions" field — mapping real endpoints needs a human who has read',
    "the actual API docs; guessing at those would be actively misleading.",
    "",
    `Vendor / product name: ${vendorName}`,
    ...(hint ? [`Additional context supplied by the requester: ${hint}`] : []),
  ].join("\n");
}

export class SuggestParseError extends Error {
  constructor() {
    super("The AI's reply wasn't a parseable draft — try again, or write the vendor request by hand.");
    this.name = "SuggestParseError";
  }
}

/** Parse the model's reply into a manifest-shaped object, tagging it as AI-suggested
 *  regardless of what the model actually wrote in "notes" (belt and braces — the UI's
 *  "unverified" framing must never depend on the model having followed instructions). */
export function parseSuggestedManifest(content: string, vendorName: string): Record<string, unknown> {
  const parsed = extractJson(content);
  if (!parsed) throw new SuggestParseError();
  const notes = typeof parsed["notes"] === "string" && parsed["notes"].trim() ? parsed["notes"] : "";
  const flagged = notes.toLowerCase().startsWith("ai-suggested")
    ? notes
    : `AI-suggested, unverified — review before use.${notes ? ` ${notes}` : ""}`;
  return {
    id: typeof parsed["id"] === "string" ? parsed["id"] : "",
    label: typeof parsed["label"] === "string" ? parsed["label"] : vendorName,
    docsUrl: typeof parsed["docsUrl"] === "string" ? parsed["docsUrl"] : "",
    via: typeof parsed["via"] === "string" ? parsed["via"] : "",
    requiredEnv: Array.isArray(parsed["requiredEnv"]) ? parsed["requiredEnv"].filter((e) => typeof e === "string") : [],
    capabilities:
      parsed["capabilities"] && typeof parsed["capabilities"] === "object"
        ? Object.fromEntries(
            Object.entries(parsed["capabilities"] as Record<string, unknown>)
              .filter(([k]) => (CAPABILITY_DOMAINS as readonly string[]).includes(k))
              .map(([k, v]) => [k, !!v]),
          )
        : {},
    notes: flagged,
  };
}
