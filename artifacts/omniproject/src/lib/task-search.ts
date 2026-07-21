import { ORDINAL_LEVELS_BY_KIND, TASK_CLOSED_STATUSES, type FilterNode, type FilterPredicate } from "@workspace/backend-catalogue";

/**
 * TASK SEARCH SYNTAX — pure. Parses a search box string into free text + a boolean filter tree for the ONE
 * shared sort/filter engine, so "sort by any column + filter" and search read the same predicates. A mini
 * grammar (Todoist/Task-Café-ish), any token optionally negated with a leading `-`:
 *
 *   #tag                    tags include <tag>
 *   @context                context = <context>
 *   is:overdue | today | soon | scheduled     urgency band (needs the row enriched with `_urgency`)
 *   is:untouched            gone stale (needs the row enriched with `_untouched`)
 *   is:done | open          closed vs open (by status)
 *   status:<s>              status = <s>
 *   priority:<p> / p:<p>    priority = <p>
 *   priority>=high (>,>=,<,<=)   priority compared by INTERNAL LEVEL (ordinal), so "urgent" > "low"
 *   <anything else>         free text (matched against the title by the caller)
 *
 * Returns `{ text, where }`. The caller enriches each row with `_urgency`/`_untouched` (see task-urgency),
 * filters with `filterRowsBoolean(rows, where)`, then applies the free `text` against the title/notes. An
 * empty query ⇒ `{ text: "", where: { all: [] } }` (matches everything).
 */

export interface ParsedTaskSearch {
  text: string;
  where: FilterNode;
}

/** Options for {@link parseTaskSearch}. `expandTag` maps a tag to its descendant tags (from the per-user tag
 *  hierarchy), so a `#parent` query also matches tasks carrying a child tag. Absent ⇒ exact-tag match only. */
export interface TaskSearchOptions {
  expandTag?: (tag: string) => string[];
}

// The closed statuses come from the task-status vocabulary (asset-backed), never hand-listed here.
const CLOSED_STATUSES = [...TASK_CLOSED_STATUSES];
const URGENCY_ALIAS: Record<string, string> = { overdue: "overdue", today: "due-today", soon: "due-soon", scheduled: "scheduled" };
const priorityLevels = ORDINAL_LEVELS_BY_KIND.priority;

/** Parse a single non-negated operator token to a predicate (or a node), or null when it's free text. */
function parseToken(tok: string, opts: TaskSearchOptions): FilterNode | null {
  if (tok.startsWith("#") && tok.length > 1) {
    const tag = tok.slice(1);
    const descendants = opts.expandTag?.(tag) ?? [];
    // Hierarchy-aware: a parent tag matches itself OR any descendant tag (OR over the family).
    if (descendants.length > 0) {
      return { any: [tag, ...descendants].map((t) => ({ field: "tags", op: "has", value: t })) };
    }
    return { field: "tags", op: "has", value: tag };
  }
  if (tok.startsWith("@") && tok.length > 1) return { field: "context", op: "eq", value: tok.slice(1) };

  const colon = /^([a-z]+)(:|>=|<=|>|<)(.+)$/i.exec(tok);
  if (colon) {
    const key = colon[1]!.toLowerCase();
    const opTok = colon[2]!;
    const val = colon[3]!;
    if (key === "is") {
      const v = val.toLowerCase();
      if (URGENCY_ALIAS[v]) return { field: "_urgency", op: "eq", value: URGENCY_ALIAS[v] };
      if (v === "untouched") return { field: "_untouched", op: "truthy" };
      if (v === "done") return { field: "status", op: "in", value: CLOSED_STATUSES };
      if (v === "open") return { not: { field: "status", op: "in", value: CLOSED_STATUSES } };
      return null; // unknown is:x → treat as free text
    }
    if (key === "status") return { field: "status", op: "eq", value: val };
    if (key === "priority" || key === "p") {
      const p = val.toLowerCase();
      if (opTok === ":") return { field: "priority", op: "eq", value: p };
      const op = ({ ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" } as const)[opTok]!;
      return { field: "priority", op, value: p, kind: "ordinal", levels: priorityLevels } as FilterPredicate;
    }
  }
  return null; // free text
}

export function parseTaskSearch(query: string, opts: TaskSearchOptions = {}): ParsedTaskSearch {
  const tokens = (query ?? "").trim().split(/\s+/).filter(Boolean);
  const nodes: FilterNode[] = [];
  const textParts: string[] = [];
  for (const raw of tokens) {
    const negated = raw.startsWith("-") && raw.length > 1;
    const tok = negated ? raw.slice(1) : raw;
    const node = parseToken(tok, opts);
    if (!node) { textParts.push(raw); continue; } // free text (keep the original, incl. a literal leading -)
    nodes.push(negated ? { not: node } : node);
  }
  return { text: textParts.join(" "), where: { all: nodes } };
}
