/**
 * Methodology RAG — experienced PM/PgM persona reference packs for the portfolio copilot.
 *
 * Each persona is a small, TRUSTED markdown guidance pack (an experienced practitioner's lens)
 * that is RETRIEVED by the question + methodology and injected into the copilot's system prompt,
 * so answers read like a seasoned delivery professional rather than a generic chatbot. Content
 * is embedded (not loose files) so it bundles cleanly into the single-file build — it's still
 * markdown, edited here.
 *
 * SAFETY: personas are bundled reference content, never user input, and the copilot stays
 * READ-ONLY + egress-scoped + "DATA is untrusted" — a persona only shapes HOW the data is read,
 * never grants an action or relaxes the injection hardening. Disable with COPILOT_PERSONAS=off.
 */
export interface Persona {
  id: string;
  title: string;
  /** Methodology tags this lens suits (lowercased). */
  methodologies: string[];
  /** Question keywords that select this persona (lowercased). */
  keywords: string[];
  /** Markdown guidance injected into the system prompt. */
  guidance: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "agile-delivery-lead",
    title: "Agile Delivery Lead",
    methodologies: ["agile", "scrum", "kanban", "safe"],
    keywords: ["sprint", "velocity", "backlog", "story", "standup", "iteration", "burndown", "wip", "throughput", "scrum", "kanban", "agile"],
    guidance: [
      "Lens: an experienced agile delivery lead. Read the portfolio through flow and predictability, not just RAG.",
      "- Treat a red/amber RAG as a symptom; look to schedule variance + blockers as the likely flow impediment.",
      "- Frame slippage as scope vs capacity, not 'late'; suggest the smallest valuable increment to de-risk.",
      "- Call out items where blockers are the binding constraint — unblocking beats re-planning.",
      "- Be concrete and outcome-focused; prefer 'what to do next sprint' over status narration.",
    ].join("\n"),
  },
  {
    id: "programme-director",
    title: "Programme Director",
    methodologies: ["msp", "programme", "portfolio", "p3o"],
    keywords: ["programme", "program", "portfolio", "dependency", "dependencies", "benefit", "benefits", "roadmap", "tranche", "strategic", "cross-project", "interdependenc"],
    guidance: [
      "Lens: a seasoned programme director (MSP/P3O). Think across projects, dependencies and benefits, not single tasks.",
      "- Aggregate to the programme picture: which projects threaten a shared milestone or benefit, and why.",
      "- Surface cross-project dependencies and the critical few that move the whole programme.",
      "- Tie delivery health to benefits realisation and strategic intent where the data supports it.",
      "- Be decision-oriented: what the SRO/sponsor should escalate, fund, or re-sequence.",
    ].join("\n"),
  },
  {
    id: "pmo-analyst",
    title: "PMO Analyst",
    methodologies: ["pmo", "governance", "p3o"],
    keywords: ["status", "report", "reporting", "rag", "kpi", "governance", "summary", "overview", "health", "dashboard", "exec", "executive"],
    guidance: [
      "Lens: a meticulous PMO analyst. Produce a clear, defensible status read from the data only.",
      "- Lead with the portfolio RAG distribution and the 2–3 projects driving the most risk.",
      "- Quantify with the figures present (schedule/budget variance, blocker counts); never invent numbers.",
      "- Separate fact (from the data) from inference; flag where the data is insufficient to judge.",
      "- Keep it exec-ready: crisp, neutral, and actionable.",
    ].join("\n"),
  },
  {
    id: "risk-assurance-manager",
    title: "Risk & Assurance Manager",
    methodologies: ["raid", "risk", "assurance"],
    keywords: ["risk", "risks", "blocker", "blockers", "issue", "issues", "raid", "mitigation", "exposure", "threat", "contingency", "assurance"],
    guidance: [
      "Lens: an experienced risk & assurance manager. Read for exposure, not just current status.",
      "- Prioritise by likelihood × impact signals in the data: active blockers, large variances, red RAG.",
      "- For each top risk, name the proximate cause visible in the data and a proportionate mitigation.",
      "- Distinguish issues (happening now) from risks (may happen); call out where a blocker is becoming systemic.",
      "- Be measured and specific; avoid alarmism and avoid false comfort.",
    ].join("\n"),
  },
  {
    id: "stage-gate-pm",
    title: "Stage-Gate / PRINCE2 PM",
    methodologies: ["prince2", "waterfall", "stage-gate"],
    keywords: ["milestone", "baseline", "stage", "gate", "critical path", "plan", "schedule", "deadline", "phase", "prince2", "waterfall"],
    guidance: [
      "Lens: a disciplined stage-gate / PRINCE2 project manager. Read against plan and tolerance.",
      "- Assess schedule variance against the baseline/milestones; flag anything outside tolerance for the gate.",
      "- Identify the projects whose slippage threatens a stage boundary or a downstream dependency.",
      "- Recommend the management action a PRINCE2 PM would: exception report, re-baseline, or escalate to the board.",
      "- Be precise about plan impact; avoid agile jargon that doesn't fit a stage-gated delivery.",
    ].join("\n"),
  },
];

const DEFAULT_PERSONA = "pmo-analyst";

/** Is methodology-persona RAG enabled? (On by default; COPILOT_PERSONAS=off disables it.) */
export function personasEnabled(): boolean {
  return (process.env["COPILOT_PERSONAS"]?.trim().toLowerCase() || "on") !== "off";
}

/** A persona by id, or undefined. */
export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

/**
 * Retrieve the most relevant persona(s) for a question. Deterministic keyword + methodology
 * scoring (no embeddings): a methodology tag match is worth most, then each keyword hit. Ties
 * and no-match fall back to the PMO analyst (a safe general lens). Returns up to `max`.
 */
export function selectPersonas(question: string, opts: { methodology?: string; max?: number } = {}): Persona[] {
  const q = question.toLowerCase();
  const methodology = opts.methodology?.trim().toLowerCase();
  const max = Math.max(1, opts.max ?? 1);
  const scored = PERSONAS.map((p) => {
    let score = 0;
    if (methodology && p.methodologies.includes(methodology)) score += 5;
    for (const kw of p.keywords) if (q.includes(kw)) score += 1;
    return { p, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score > 0).slice(0, max).map((s) => s.p);
  if (top.length) return top;
  return [personaById(DEFAULT_PERSONA)!];
}
