import { WORK_PRIORITIES } from "@workspace/backend-catalogue";
import { parseNaturalDate } from "./natural-date";

/**
 * QUICK-ADD INLINE SYNTAX — pure. Parses a single typed line into the fields of a next-action, so the
 * quick-add bar can go straight from a keystroke to a brokered create. Todoist/Task-Café-style sigils:
 *
 *   #tag        →  a tag (repeatable)
 *   @context    →  the GTD context (last one wins)
 *   !p1..!p4    →  priority (p1=urgent … p4=low); or a named token !urgent/!high/!medium/!low/!none
 *   ^<phrase>   →  due date — the words AFTER ^ up to the next sigil, parsed by natural-date
 *                  (so "^next friday", "^in 3 days", "^2026-03-01" all work)
 *
 * Everything not consumed by a sigil is the title (whitespace-collapsed). The reference `today` is injected
 * (no clock here) so the parse is pure + testable. A bare sigil with no value (a lone "#"/"@"/"!"/"^") is
 * treated as literal title text, so typing mid-word never loses characters.
 */

export interface QuickAddResult {
  title: string;
  tags: string[];
  context: string | null;
  priority: string | null; // a canonical WorkPriority id, or null when none given
  dueDate: string | null;  // ISO YYYY-MM-DD, or null
}

const PRIORITY_BY_PN: Record<string, string> = { p1: "urgent", p2: "high", p3: "medium", p4: "low", p5: "none" };
const isSigil = (tok: string): boolean => /^[#@!^]/.test(tok) && tok.length > 1;

/** Resolve a `!`-token to a canonical priority id, or null if it isn't one. */
function resolvePriority(raw: string): string | null {
  const v = raw.toLowerCase();
  if (PRIORITY_BY_PN[v]) return PRIORITY_BY_PN[v]!;
  return (WORK_PRIORITIES as readonly string[]).includes(v) ? v : null;
}

export function parseQuickAdd(input: string, today: Date): QuickAddResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const titleParts: string[] = [];
  const tags: string[] = [];
  let context: string | null = null;
  let priority: string | null = null;
  let dueDate: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!isSigil(tok)) { titleParts.push(tok); continue; }
    const sigil = tok[0]!;
    const value = tok.slice(1);
    if (sigil === "#") { if (!tags.includes(value)) tags.push(value); continue; }
    if (sigil === "@") { context = value; continue; }
    if (sigil === "!") {
      const p = resolvePriority(value);
      if (p) priority = p; else titleParts.push(tok); // not a known priority → keep as title text
      continue;
    }
    // ^ — collect this token's value + following plain tokens (up to the next sigil) as the date phrase.
    const phraseParts = [value];
    while (i + 1 < tokens.length && !isSigil(tokens[i + 1]!)) phraseParts.push(tokens[++i]!);
    const parsed = parseNaturalDate(phraseParts.join(" "), today);
    if (parsed) dueDate = parsed;
    else titleParts.push(tok, ...phraseParts.slice(1)); // unparseable → keep the words as title text
  }

  return { title: titleParts.join(" ").trim(), tags, context, priority, dueDate };
}
