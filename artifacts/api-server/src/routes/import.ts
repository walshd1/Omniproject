import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { getBroker, contextFromReq, respondBrokerError } from "../broker";
import { commitImport } from "../lib/import";
import { guardProjectScope } from "../lib/project-scope";
import { recordAudit } from "../lib/audit";

/** Hard cap on rows per commit — each row is a broker write, so an unbounded array is a
 *  write-amplification DoS. The 256kb body limit bounds it in practice; this is the explicit floor. */
const MAX_IMPORT_ROWS = 5_000;
import {
  suggestColumnMapping,
  applyColumnMapping,
  mappingFromSuggestions,
  type MappingEntry,
  type ColumnSuggestion,
} from "../lib/column-mapper";
import type { FieldType } from "../lib/field-registry";

/**
 * Tabular import — the column/field mapper surfaced over HTTP. Backend-neutral:
 * the same two endpoints serve an Excel/CSV upload or a SQL/Mongo result set
 * (whatever produced `{ headers, rows }`). PURE mapping lives in lib/column-mapper;
 * this is the thin shell that previews a mapping and (on confirm) writes the rows
 * through the active broker — so imports honour the SAME capability gates, broker
 * seam and business ruleset as a hand-typed create. No data is stored here.
 */
const router = Router();

const isRows = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.every((r) => r != null && typeof r === "object" && !Array.isArray(r));

/** Headers come either explicitly or from the union of keys across the rows. */
function headersOf(body: { headers?: unknown; rows?: Record<string, unknown>[] }): string[] {
  if (Array.isArray(body.headers) && body.headers.every((h) => typeof h === "string")) return body.headers as string[];
  const seen = new Set<string>();
  for (const r of body.rows ?? []) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function isMapping(v: unknown): v is MappingEntry[] {
  return Array.isArray(v) && v.every((m) => m != null && typeof m === "object" && typeof (m as MappingEntry).column === "string" && typeof (m as MappingEntry).field === "string" && typeof (m as MappingEntry).type === "string");
}

/**
 * POST /import/preview — suggest a column→field mapping and (if sample rows are
 * given) show how they map. No writes; safe to call repeatedly while tuning.
 */
router.post("/import/preview", requireRole("contributor"), (req, res) => {
  const body = (req.body ?? {}) as { headers?: unknown; rows?: unknown };
  const rows = isRows(body.rows) ? body.rows : [];
  // Same cap as /commit: headersOf unions keys across EVERY row (O(rows × cols)), so an unbounded
  // preview array is a CPU-amplification vector even though it writes nothing.
  if (rows.length > MAX_IMPORT_ROWS) {
    res.status(413).json({ error: `Too many rows: ${rows.length} exceeds the ${MAX_IMPORT_ROWS}-row import cap. Split the import.` });
    return;
  }
  const headers = headersOf({ headers: body.headers, rows });
  if (headers.length === 0) {
    res.status(400).json({ error: "Provide { headers: string[] } or { rows: object[] }" });
    return;
  }
  const suggestions: ColumnSuggestion[] = suggestColumnMapping(headers);
  const mapping = mappingFromSuggestions(suggestions);
  const sample = rows.slice(0, 20);
  res.json({
    mapping: suggestions,
    unmapped: suggestions.filter((s) => s.suggestedField === null).map((s) => s.column),
    preview: applyColumnMapping(sample, mapping),
    rowCount: rows.length,
  });
});

/**
 * POST /import/commit — apply a confirmed mapping and write each row as an issue
 * through the active broker. Respects the business ruleset PER ROW (a hard-blocked
 * row is skipped with its reason, never forced through). Returns a per-row outcome.
 */
router.post("/import/commit", requireRole("contributor"), async (req, res) => {
  const body = (req.body ?? {}) as { projectId?: unknown; rows?: unknown; mapping?: unknown };
  if (typeof body.projectId !== "string" || !body.projectId) {
    res.status(400).json({ error: "Body must include { projectId: string }" });
    return;
  }
  if (!isRows(body.rows) || body.rows.length === 0) {
    res.status(400).json({ error: "Body must include a non-empty { rows: object[] }" });
    return;
  }
  if (body.rows.length > MAX_IMPORT_ROWS) {
    res.status(413).json({ error: `Too many rows: ${body.rows.length} exceeds the ${MAX_IMPORT_ROWS}-row import cap. Split the import.` });
    return;
  }
  const projectId = body.projectId;
  // Import writes an issue per row into `projectId` via the broker (scope-blind) — so enforce the
  // caller's project scope here too, else a contributor could bulk-write issues into any tenant's project.
  if (!(await guardProjectScope(req, res, projectId))) return;
  const rows = body.rows;
  const mapping: MappingEntry[] = isMapping(body.mapping)
    ? body.mapping
    : mappingFromSuggestions(suggestColumnMapping(headersOf({ rows })));
  if (mapping.length === 0) {
    res.status(400).json({ error: "No usable column mapping — nothing would be imported" });
    return;
  }
  // A row with no title can't form a valid issue (title is the one structural must).
  const titled = mapping.some((m) => m.field === "title");
  if (!titled) {
    res.status(400).json({ error: "Mapping must include a column for 'title'" });
    return;
  }

  const payloads = applyColumnMapping(rows, mapping);
  const role = roleForReq(req);
  const { created, skipped } = await commitImport({
    broker: getBroker(),
    ctx: contextFromReq(req),
    role,
    projectId,
    payloads,
    onRowError: (row, err) => req.log.error({ err, row }, "import_commit row failed"),
  });

  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "import_commit",
    projectId,
    actor: { role },
    write: true,
    result: created.length > 0 ? "success" : "error",
    status: 200,
    meta: { total: payloads.length, created: created.length, skipped: skipped.length },
  });

  if (created.length === 0) {
    // Nothing landed — surface as an error so a caller doesn't think it imported.
    respondBrokerError(res, new Error("No rows were imported"));
    return;
  }
  res.status(created.length === payloads.length ? 201 : 207).json({
    projectId,
    total: payloads.length,
    created,
    skipped,
    fields: mapping.map((m) => ({ column: m.column, field: m.field, type: m.type as FieldType })),
  });
});

export default router;
