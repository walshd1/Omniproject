/**
 * MULTI-ENTRY AUTO-SPLIT — pure. Turns one pasted/typed blob into individual entry lines, so a single
 * add box can create MANY tasks (or issues) at once, Todoist-style: paste a list, get one item per line.
 *
 * This is deliberately just the SPLIT — each resulting line is still fed through the per-entity parser
 * (lib/quick-add.parseQuickAdd for tasks) so inline sigils (#tag @context !p1 ^date) keep working per
 * line. Kept pure + free of any entity/react coupling so both the Tasks quick-add and the New-Task
 * (issue) dialog share it and it's trivially testable.
 */

/** Hard cap on how many lines one paste can become — a guard so a giant/accidental paste can't fan out
 *  into hundreds of brokered creates. Anything beyond the cap is reported via `truncated`, never dropped
 *  silently. */
export const MAX_MULTI_ENTRY = 50;

export interface MultiEntrySplit {
  /** The non-blank, trimmed lines to create, in order, capped at `max`. */
  lines: string[];
  /** How many non-blank lines were dropped by the cap (0 when nothing was truncated). */
  truncated: number;
}

/**
 * Split a blob into entry lines: one item per non-blank line. Splits on CR/LF/CRLF, trims each line, and
 * drops blank lines (so trailing newlines, or blank separator lines in a paste, never create empty
 * items). The result is capped at `max`; the overflow count is returned in `truncated` rather than
 * silently dropped.
 */
export function splitEntryLines(raw: string, max = MAX_MULTI_ENTRY): MultiEntrySplit {
  const all = raw.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return { lines: all.slice(0, Math.max(0, max)), truncated: Math.max(0, all.length - max) };
}

/**
 * Whether a blob should AUTO-SPLIT — i.e. it yields ≥2 non-blank lines. A single line (or a blob with
 * one line of text plus blank lines) is NOT multi-line, so ordinary single-item entry is untouched and
 * only a genuine multi-line paste triggers the split flow.
 */
export function isMultiLine(raw: string): boolean {
  return splitEntryLines(raw).lines.length >= 2;
}
