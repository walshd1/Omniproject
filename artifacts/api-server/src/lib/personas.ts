import { PERSONAS, getPersona, type Persona } from "@workspace/backend-catalogue";

/**
 * Methodology RAG — persona SELECTION for the portfolio copilot.
 *
 * The persona packs themselves (the experienced PM/PgM lenses) are DATA: authored as JSON
 * under lib/backend-catalogue/assets/personas/ and embedded by gen-personas (drift-guarded in
 * CI), exactly like the methodology catalogue. This module is the gateway-side LOGIC: which
 * persona to retrieve for a question + methodology, and the kill-switch. Keeping the content in
 * the catalogue lets a persona PACK ship as an importable bundle and keeps this file to behaviour.
 *
 * SAFETY: personas are bundled reference content, never user input, and the copilot stays
 * READ-ONLY + egress-scoped + "DATA is untrusted" — a persona only shapes HOW the data is read,
 * never grants an action or relaxes the injection hardening. Disable with COPILOT_PERSONAS=off.
 */
export type { Persona };
export { PERSONAS };

const DEFAULT_PERSONA = "pmo-analyst";

/** Is methodology-persona RAG enabled? (On by default; COPILOT_PERSONAS=off disables it.) */
export function personasEnabled(): boolean {
  return (process.env["COPILOT_PERSONAS"]?.trim().toLowerCase() || "on") !== "off";
}

/** A persona by id, or undefined. */
export function personaById(id: string): Persona | undefined {
  return getPersona(id);
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
