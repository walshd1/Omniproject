import { MCP_TOOLS, type McpTool } from "./mcp";

/**
 * Natural-language → canonical action planner.
 *
 * Maps a free-text instruction ("show overdue work in Apollo", "mark issue 42 done") onto
 * ONE of the registered canonical actions (the same MCP tool catalogue the agent surface
 * uses) plus validated arguments. It PLANS — it never executes. The caller decides what to
 * do with the plan: a human command palette confirms a write before running it; an
 * autonomous actor runs it only through the write-scope guard (lib/autonomous-grant).
 *
 * Safety properties:
 *  - Closed vocabulary: the chosen action MUST be a known tool; anything else ⇒ "none".
 *  - Schema-bound args: only the tool's declared properties are kept (unknown keys are
 *    dropped — the model can't smuggle extra fields), and required args must be present
 *    or the planner asks to CLARIFY rather than guessing.
 *  - Writes are flagged (`write`) so the caller always knows a mutation is proposed.
 *
 * The model call is injected (`complete`) so the planning/validation logic is
 * deterministically testable without a live provider.
 */
export type ActionPlan =
  | { kind: "action"; tool: string; action: string; args: Record<string, unknown>; write: boolean }
  | { kind: "clarify"; question: string }
  | { kind: "none"; reason: string };

export type Completer = (prompt: string) => Promise<string>;

/** The catalogue line the model sees for one tool (name, what it does, its args). */
function toolLine(t: McpTool): string {
  const props = Object.keys(t.inputSchema.properties ?? {});
  const required = t.inputSchema.required ?? [];
  const args = props.map((p) => (required.includes(p) ? `${p} (required)` : p)).join(", ") || "none";
  return `- ${t.name}${t.write ? " [WRITE]" : ""}: ${t.description} | args: ${args}`;
}

/** Build the planner prompt: the catalogue + a strict JSON output contract. */
export function plannerPrompt(text: string, tools: McpTool[]): string {
  return [
    "You map a user instruction to ONE tool from the catalogue below, or ask to clarify, or decline.",
    "Reply with ONLY a JSON object, no prose, in one of these shapes:",
    '  {"tool":"<name>","args":{...}}   — when the instruction clearly maps to a tool',
    '  {"clarify":"<question>"}          — when required arguments are missing or ambiguous',
    '  {"none":"<reason>"}               — when no tool fits',
    "Use ONLY tools and argument names from the catalogue. Never invent arguments.",
    "",
    "Catalogue:",
    ...tools.map(toolLine),
    "",
    `Instruction: ${text}`,
  ].join("\n");
}

/** Pull the first JSON object out of a model reply (tolerant of code fences / prose). */
function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Validate a parsed model reply against the tool catalogue into a typed plan. */
export function toPlan(parsed: Record<string, unknown> | null, tools: McpTool[]): ActionPlan {
  if (!parsed) return { kind: "none", reason: "could not parse a plan" };
  if (typeof parsed["clarify"] === "string") return { kind: "clarify", question: parsed["clarify"] };
  if (typeof parsed["none"] === "string") return { kind: "none", reason: parsed["none"] };

  const name = parsed["tool"];
  if (typeof name !== "string") return { kind: "none", reason: "no tool chosen" };
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { kind: "none", reason: `unknown tool "${name}"` };

  // Keep ONLY declared properties — drop anything the model invented.
  const declared = Object.keys(tool.inputSchema.properties ?? {});
  const rawArgs = (parsed["args"] && typeof parsed["args"] === "object") ? (parsed["args"] as Record<string, unknown>) : {};
  const args: Record<string, unknown> = {};
  for (const k of declared) if (k in rawArgs && rawArgs[k] !== undefined && rawArgs[k] !== null && rawArgs[k] !== "") args[k] = rawArgs[k];

  // Required args must be present, else ask rather than guess.
  const missing = (tool.inputSchema.required ?? []).filter((r) => !(r in args));
  if (missing.length) return { kind: "clarify", question: `Which ${missing.join(", ")}?` };

  return { kind: "action", tool: tool.name, action: tool.action, args, write: !!tool.write };
}

/**
 * Plan an action from natural language. `allowWrites=false` filters write tools out of the
 * catalogue entirely, so a read-only caller can never even be offered a mutation.
 */
export async function planAction(opts: { text: string; complete: Completer; tools?: McpTool[]; allowWrites?: boolean }): Promise<ActionPlan> {
  const text = opts.text.trim();
  if (!text) return { kind: "none", reason: "empty instruction" };
  const tools = (opts.tools ?? MCP_TOOLS).filter((t) => opts.allowWrites || !t.write);
  const raw = await opts.complete(plannerPrompt(text, tools));
  return toPlan(extractJson(raw), tools);
}
