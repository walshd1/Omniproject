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

/** Server-driven maximum page size (ODATA_MAX_PAGE, default 1000). Every feed response is bounded to
 *  this many rows so a client can't pull the whole corpus in one shot; more rows ⇒ an @odata.nextLink. */
export const ODATA_MAX_PAGE = (() => {
  const n = Number(process.env["ODATA_MAX_PAGE"]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000;
})();

/**
 * Apply $filter/$select/$top/$skip/$orderby/$count to a row set (in-memory OData query).
 *
 * `allowed` is the entity's DECLARED property names (from the EDM model). When supplied, every row is
 * projected down to those props before serialising — so a backend that returns extra internal fields
 * can't leak them through the feed — and `$select` is intersected with the model (a caller can't
 * `$select` an un-modeled field to pull it back). Omit `allowed` only for un-modeled/raw callers.
 *
 * Bounds every page to {@link ODATA_MAX_PAGE}; when more rows remain it returns `nextSkip` so the
 * route can emit an @odata.nextLink (server-driven paging, never a silent truncation).
 */
export function applyODataQuery(rows: Row[], q: ODataQuery, allowed?: readonly string[]): { rows: Row[]; count?: number; nextSkip?: number } {
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

  // Server-driven paging: always bound the page to ODATA_MAX_PAGE, even when the caller sends no
  // $top — otherwise a BI poll materialises + serialises the whole corpus (the 10k-project OOM risk).
  // A truncated result carries an @odata.nextLink (built by the route) so nothing is silently dropped.
  const skipRaw = Number(q.$skip);
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const topRaw = Number(q.$top);
  const pageSize = Number.isFinite(topRaw) && topRaw >= 0 ? Math.min(Math.floor(topRaw), ODATA_MAX_PAGE) : ODATA_MAX_PAGE;
  out = out.slice(skip, skip + pageSize);
  const nextSkip = skip + out.length < total ? skip + out.length : undefined;

  // Projection: start from the declared model props (if given), then narrow to $select — both
  // restricted to the model so no un-modeled backend field is ever serialised into the feed.
  let fields: string[] | null = allowed ? [...allowed] : null;
  if (q.$select) {
    const requested = q.$select.split(",").map((s) => s.trim()).filter(Boolean);
    fields = fields ? requested.filter((f) => fields!.includes(f)) : requested;
  }
  if (fields) {
    const proj = fields;
    out = out.map((r) => Object.fromEntries(proj.map((f) => [f, r[f]])) as Row);
  }

  const wantCount = String(q.$count).toLowerCase() === "true";
  return {
    rows: out,
    ...(wantCount ? { count: total } : {}),
    ...(nextSkip !== undefined ? { nextSkip } : {}),
  };
}

/** Wrap a row set in the OData v4 entity-set JSON envelope (@odata.context etc.). `nextLink` is set
 *  when the result was capped by server-driven paging, so a client can fetch the next page. */
export function entitySetEnvelope(baseUrl: string, set: string, rows: Row[], count?: number, nextLink?: string) {
  return {
    "@odata.context": `${baseUrl}$metadata#${set}`,
    ...(count !== undefined ? { "@odata.count": count } : {}),
    ...(nextLink ? { "@odata.nextLink": nextLink } : {}),
    value: rows,
  };
}
