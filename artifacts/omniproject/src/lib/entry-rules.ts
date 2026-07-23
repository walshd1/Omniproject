import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * ENTRY BUSINESS-RULE PUSHBACK — the client side of the server's business ruleset (lib/ruleset). The
 * server is the authority (it 422s a write that breaks a hard rule), but discovering that only on submit
 * is a poor, Excel-flight-inducing experience. So the SPA fetches the EFFECTIVE field requirements for
 * the caller's scope up front (GET /api/rules/active) and pushes back gently, inline, BEFORE the create:
 * a required field that's missing blocks the button with a clear message, never a scary post-hoc error.
 *
 * The evaluator here mirrors the server's presence check exactly (incl. priority's "none" sentinel), so
 * the client's verdict matches the server's — no false blocks, no missed ones.
 */

/** One field requirement for entry — mirrors the server's `EntryRequirement` (lib/ruleset). */
export interface EntryRequirement {
  rule: string;
  action: string;
  field: string;
  mode: "hard" | "warn";
  message: string;
  whenPresent?: string;
}

export const ENTRY_RULES_KEY = ["rules", "active"] as const;

/** Fetch the effective entry field-requirements for the given scope (org, or a project when supplied). */
export function useActiveEntryRules(projectId?: string) {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return useQuery({
    queryKey: [...ENTRY_RULES_KEY, projectId ?? "org"],
    queryFn: () => getJson<{ requirements: EntryRequirement[] }>(`/api/rules/active${q}`),
  });
}

/**
 * Is a field value "present" for rule purposes? Mirrors the server: null/empty is absent; an empty array
 * is absent; and — for `priority` — the UI's `"none"` sentinel counts as absent (so require-priority
 * isn't trivially satisfied by the forms' default).
 */
export function fieldPresent(field: string, value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return false;
    if (field === "priority" && t.toLowerCase() === "none") return false;
    return true;
  }
  return true;
}

export interface Violation { field: string; mode: "hard" | "warn"; message: string; rule: string }

/**
 * Evaluate a candidate entry (field→value) against the active requirements for one action. A missing
 * hard field is a block; a missing warn field is a nudge. A dependency rule (`whenPresent`) only fires
 * when its trigger field is itself present.
 */
export function evaluateEntry(
  fields: Record<string, unknown>,
  requirements: EntryRequirement[] | undefined,
  action: string,
): Violation[] {
  if (!requirements) return [];
  const out: Violation[] = [];
  for (const r of requirements) {
    if (r.action !== action) continue;
    if (r.whenPresent && !fieldPresent(r.whenPresent, fields[r.whenPresent])) continue;
    if (fieldPresent(r.field, fields[r.field])) continue;
    out.push({ field: r.field, mode: r.mode, message: r.message, rule: r.rule });
  }
  return out;
}

/** The HARD violations only — the ones that must block a create (warns are advisory nudges). */
export function hardViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => v.mode === "hard");
}
