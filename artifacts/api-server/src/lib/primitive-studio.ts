/**
 * PRIMITIVE STUDIO — the server "skill" that turns a plain description into a candidate `primitive` registry
 * bundle, then TESTS it against the shared schema so the caller gets structured pass/fail feedback. Follows
 * the codebase's AI pattern (a `complete` callback the route wires to `aiChat`; defensive JSON parse; the
 * model emits ONLY a declarative descriptor, never code — see backend-suggest). "AI proposes, human disposes":
 * this only GENERATES + VALIDATES; the write happens through the normal registry submit path (sanitiser +
 * admin review), which the SPA calls once the user is happy.
 *
 * Pure + injectable: `generatePrimitiveBundle(input, complete)` takes the completion function, so it is fully
 * testable with a canned `complete` — no network, no provider.
 */
import { extractJson } from "./nl-action";
import type { ChatMessage, ChatImage } from "./ai";
import {
  PRIMITIVE_CATEGORIES, PRIMITIVE_PARAM_TYPES, CHART_VIEW_TYPES,
  validatePrimitiveDef, type PrimitiveDefShape,
} from "@workspace/backend-catalogue";

/** The model reply wasn't parseable JSON at all (distinct from a parseable-but-invalid primitive). */
export class PrimitiveStudioParseError extends Error {
  constructor() {
    super("The AI's reply wasn't a parseable primitive — try again, or refine your description.");
    this.name = "PrimitiveStudioParseError";
  }
}

/** What the caller asks for: a description, plus (for iteration) the previous bundle + their feedback, and
 *  optionally a reference image the primitive should be based on (vision-capable providers only). */
export interface PrimitiveStudioInput {
  description: string;
  /** The user's refinement request for the previous attempt (drives an iteration). */
  feedback?: string;
  /** The previous attempt's payload, so the model refines rather than starting over. */
  previous?: Record<string, unknown>;
  /** A reference picture (a sketch / screenshot of the chart the user wants). */
  image?: ChatImage;
}

/** A registry submission the studio proposes (kind is always `primitive`). */
export interface PrimitiveSubmission {
  kind: "primitive";
  name: string;
  publisher: string;
  version: string;
  description: string;
  tags: string[];
  payload: Record<string, unknown>;
}

/** The studio's result: the proposed submission + the deterministic test outcome. */
export interface PrimitiveStudioResult {
  submission: PrimitiveSubmission;
  /** Whether the payload passed `validatePrimitiveDef`. */
  valid: boolean;
  /** Every validation problem (empty when valid) — surfaced to the user to drive the next iteration. */
  errors: string[];
  /** The normalised primitive when valid. */
  def?: PrimitiveDefShape;
}

const AUTHOR = "AI Studio (unverified — review before use)";

/** The system prompt: the exact schema the model must emit, the closed sets, and the no-code contract. */
export function primitiveStudioSystemPrompt(): string {
  return [
    "You author a single VISUALISATION PRIMITIVE for a project-management app. A primitive is a DECLARATIVE,",
    "code-free descriptor of a chart/graphic — the app already owns the renderer; you only describe which",
    "inputs it takes. NEVER emit code, expressions, HTML, or URLs.",
    "",
    "Reply with ONLY a single JSON object (no markdown fences, no commentary): a registry submission with",
    "EXACTLY these fields:",
    '  "kind": "primitive"',
    '  "name": a short human name',
    '  "publisher": a short author label',
    '  "version": "1.0.0"',
    '  "description": one line describing what it shows',
    '  "tags": array of a few lowercase search labels',
    '  "payload": the primitive definition object, with:',
    '     "id": kebab-case id (lowercase letters, digits, hyphens)',
    `     "category": one of ${PRIMITIVE_CATEGORIES.join(", ")}`,
    `     "chartType": one of ${CHART_VIEW_TYPES.join(", ")} (OMIT this field if it is not a chart)`,
    '     "description": longer help text',
    '     "params": a non-empty array of authoring inputs, each:',
    '        { "key": kebab/camel id, "label": human label,',
    `          "type": one of ${PRIMITIVE_PARAM_TYPES.join(", ")},`,
    '          "required": boolean, "description": one line,',
    '          "options": [strings] ONLY when type is "enum" }',
    "",
    "Guidance: a bar/line/area chart takes a \"rows\" param (tabular data) + a \"series\" param (which keys to",
    "plot); a pie/donut takes a \"slices\" param; a scatter takes \"points\". Keep params minimal and real.",
  ].join("\n");
}

/** Build the messages for one generate/iterate request. Attaches the reference image to the user turn when
 *  one is supplied (vision-capable providers read it; text-only providers ignore it). */
export function buildPrimitiveMessages(input: PrimitiveStudioInput): ChatMessage[] {
  const user: string[] = [`Build a primitive for: ${input.description.trim()}`];
  if (input.image) user.push("", "Base the primitive on the attached reference image (match its chart type and the fields it plots).");
  if (input.previous && input.feedback) {
    user.push("", "Here is the previous attempt's payload:", JSON.stringify(input.previous), "", `Revise it to address this feedback: ${input.feedback.trim()}`);
  } else if (input.feedback) {
    user.push("", `Additional guidance: ${input.feedback.trim()}`);
  }
  return [
    { role: "system", content: primitiveStudioSystemPrompt() },
    { role: "user", content: user.join("\n"), ...(input.image ? { images: [input.image] } : {}) },
  ];
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Coerce a model reply into a normalised PrimitiveSubmission. Throws {@link PrimitiveStudioParseError} when
 *  the reply isn't JSON or carries no payload object. Identity fields are defaulted, never trusted verbatim. */
export function parsePrimitiveReply(content: string): PrimitiveSubmission {
  const parsed = extractJson(content);
  if (!parsed) throw new PrimitiveStudioParseError();
  const payload = parsed["payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new PrimitiveStudioParseError();
  const tags = Array.isArray(parsed["tags"]) ? (parsed["tags"] as unknown[]).map((t) => str(t)).filter(Boolean).slice(0, 12) : [];
  return {
    kind: "primitive",
    name: str(parsed["name"], "Untitled primitive"),
    publisher: str(parsed["publisher"], AUTHOR),
    version: str(parsed["version"], "1.0.0"),
    description: str(parsed["description"]),
    tags,
    payload: payload as Record<string, unknown>,
  };
}

/**
 * Generate a candidate primitive bundle from a description, then TEST its payload against the shared schema.
 * `complete` is the completion function (the route wires it to `aiChat`). Never throws on an invalid
 * primitive — returns `{ valid:false, errors }` so the caller can render the problems and iterate; only a
 * non-JSON reply raises {@link PrimitiveStudioParseError}.
 */
export async function generatePrimitiveBundle(
  input: PrimitiveStudioInput,
  complete: (messages: ChatMessage[]) => Promise<string>,
): Promise<PrimitiveStudioResult> {
  const content = await complete(buildPrimitiveMessages(input));
  const submission = parsePrimitiveReply(content);
  const check = validatePrimitiveDef(submission.payload);
  return {
    submission,
    valid: check.ok,
    errors: check.errors,
    ...(check.def ? { def: check.def } : {}),
  };
}
