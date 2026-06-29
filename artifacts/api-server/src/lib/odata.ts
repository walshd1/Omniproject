/**
 * Minimal, dependency-free OData v4 service helpers.
 *
 * OData is the feed format SAP, Dynamics 365, Oracle and Power BI ingest
 * natively, so this exposes OmniProject's projects / issues / programmes as an
 * OData service those ERPs/BI tools can pull (with a read-only API token).
 * Stateless — every response is computed per request. Supports the common query
 * options ($select, $top, $skip, $orderby, $count, and a minimal $filter:
 * `field eq value` and `contains(field,'x')`).
 */

export type EdmType = "Edm.String" | "Edm.Int32" | "Edm.Double" | "Edm.Boolean" | "Edm.DateTimeOffset";

export interface EntityModel {
  name: string; // EntityType name, e.g. "Project"
  set: string; // EntitySet name, e.g. "Projects"
  key: string;
  props: Record<string, EdmType>;
}

export type Row = Record<string, unknown>;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** EDMX `$metadata` document describing the entity model. */
export function buildEdmx(entities: EntityModel[], namespace = "OmniProject"): string {
  const types = entities
    .map((e) => {
      const props = Object.entries(e.props)
        .map(([name, type]) => `        <Property Name="${escapeXml(name)}" Type="${type}"/>`)
        .join("\n");
      return (
        `      <EntityType Name="${e.name}">\n` +
        `        <Key><PropertyRef Name="${e.key}"/></Key>\n` +
        `${props}\n` +
        `      </EntityType>`
      );
    })
    .join("\n");
  const sets = entities
    .map((e) => `        <EntitySet Name="${e.set}" EntityType="${namespace}.${e.name}"/>`)
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">\n` +
    `  <edmx:DataServices>\n` +
    `    <Schema Namespace="${namespace}" xmlns="http://docs.oasis-open.org/odata/ns/edm">\n` +
    `${types}\n` +
    `      <EntityContainer Name="Container">\n` +
    `${sets}\n` +
    `      </EntityContainer>\n` +
    `    </Schema>\n` +
    `  </edmx:DataServices>\n` +
    `</edmx:Edmx>\n`
  );
}

/** OData service document (entity-set listing). */
export function serviceDocument(entities: EntityModel[], baseUrl: string) {
  return {
    "@odata.context": `${baseUrl}$metadata`,
    value: entities.map((e) => ({ name: e.set, kind: "EntitySet", url: e.set })),
  };
}

// ── Query options ──────────────────────────────────────────────────────────────

function coerce(raw: string): string | number | boolean {
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? n : raw;
}

/** Apply a minimal $filter expression to a row. */
function matchesFilter(row: Row, filter: string): boolean {
  const eq = filter.match(/^\s*(\w+)\s+eq\s+(.+?)\s*$/i);
  if (eq) {
    // both capture groups are present whenever the match succeeds
    const field = eq[1]!;
    const val = coerce(eq[2]!.trim());
    return String(row[field] ?? "") === String(val);
  }
  const contains = filter.match(/^\s*contains\(\s*(\w+)\s*,\s*'(.*)'\s*\)\s*$/i);
  if (contains) {
    // both capture groups are present whenever the match succeeds
    const field = contains[1]!;
    const sub = contains[2]!;
    return String(row[field] ?? "").toLowerCase().includes(sub.toLowerCase());
  }
  // Unsupported filter → don't drop rows (be permissive).
  return true;
}

/**
 * Typed comparison for $orderby. Callers handle null/undefined ordering before
 * calling this (absent values sort to the end regardless of direction).
 * - numbers compared numerically
 * - strings compared via localeCompare
 * - otherwise: equal values preserve order (0); incomparable/heterogeneous
 *   values are treated as equal so the stable sort preserves their order.
 */
function compareValues(av: unknown, bv: unknown): number {
  if (typeof av === "number" && typeof bv === "number") {
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }
  if (typeof av === "string" && typeof bv === "string") {
    return av.localeCompare(bv);
  }
  if (typeof av === "boolean" && typeof bv === "boolean") {
    return av === bv ? 0 : av ? 1 : -1;
  }
  if (av === bv) return 0;
  // Heterogeneous / incomparable types: preserve existing order.
  return 0;
}

export interface ODataQuery {
  $select?: string;
  $top?: string;
  $skip?: string;
  $orderby?: string;
  $filter?: string;
  $count?: string;
}

/** Apply $filter/$select/$top/$skip/$orderby/$count to a row set (in-memory OData query). */
export function applyODataQuery(rows: Row[], q: ODataQuery): { rows: Row[]; count?: number } {
  let out = rows;

  if (q.$filter) out = out.filter((r) => matchesFilter(r, q.$filter!));

  const total = out.length;

  if (q.$orderby) {
    const [field = "", dir] = q.$orderby.trim().split(/\s+/);
    const sign = (dir ?? "asc").toLowerCase() === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      // Absent values always sort to the end, independent of asc/desc.
      const aMissing = av === undefined || av === null;
      const bMissing = bv === undefined || bv === null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return compareValues(av, bv) * sign;
    });
  }

  const skip = Number(q.$skip);
  if (Number.isFinite(skip) && skip > 0) out = out.slice(skip);
  const top = Number(q.$top);
  if (Number.isFinite(top) && top >= 0) out = out.slice(0, top);

  if (q.$select) {
    const fields = q.$select.split(",").map((s) => s.trim()).filter(Boolean);
    out = out.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])) as Row);
  }

  const wantCount = String(q.$count).toLowerCase() === "true";
  return wantCount ? { rows: out, count: total } : { rows: out };
}

/** Wrap a row set in the OData v4 entity-set JSON envelope (@odata.context etc.). */
export function entitySetEnvelope(baseUrl: string, set: string, rows: Row[], count?: number) {
  return {
    "@odata.context": `${baseUrl}$metadata#${set}`,
    ...(count !== undefined ? { "@odata.count": count } : {}),
    value: rows,
  };
}
