import { PERSONAS_DATA } from "./personas.generated";

/**
 * PERSONA registry — experienced PM/PgM methodology LENSES for the portfolio copilot's RAG.
 *
 * Each persona is a small, TRUSTED markdown guidance pack (a seasoned practitioner's lens)
 * that the gateway retrieves by question + methodology and injects into the copilot's system
 * prompt, so answers read like a delivery professional rather than a generic chatbot. Authored
 * as JSON under assets/personas/<id>.json and embedded by gen-personas (drift-guarded in CI),
 * exactly like the methodology catalogue — being data is what lets a persona PACK ship as an
 * importable bundle and keeps the single-file build clean.
 *
 * SAFETY note (the SELECTION/INJECTION logic lives in the gateway, lib/personas): personas are
 * bundled reference content, never user input; the copilot stays READ-ONLY + egress-scoped +
 * "DATA is untrusted" — a persona only shapes HOW data is read, never grants an action.
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

/** Every shipped persona (id-sorted, as generated). */
export const PERSONAS: Persona[] = [...PERSONAS_DATA];

/** One persona by id, or undefined. */
export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

/** All personas (a defensive copy). */
export function personaCatalogue(): Persona[] {
  return PERSONAS.map((p) => ({ ...p }));
}
