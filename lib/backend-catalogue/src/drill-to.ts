/**
 * DRILL-TO — the declarative "red number → filtered work-item list" descriptor (backlog #122). A report
 * or widget definition can carry a `drillTo` (same field-in-JSON, threaded-through-the-catalogue pattern
 * as `refresh` — see component-library.ts): when the SPA renders a clickable figure derived from this
 * component (a blocked-count, a RAG segment, …), `drillTo` says where clicking it should land and how to
 * turn the SPECIFIC data point clicked into a predicate against the grid — composing with the SAME
 * predicate shape (field/op/value, all-of/any-of) already used by the rate-card cost rules and the
 * custom report engine (see the SPA's rate-card.ts `Predicate`/`ConditionSet` and custom-report.ts
 * `matchRow`), instead of inventing a second filter language.
 *
 * This module only carries the DATA shape: JSON authoring has no notion of the SPA's typed `Op` union,
 * so `op`/`value` are kept loose here. The SPA resolver (artifacts/omniproject/src/lib/drill-to.ts) turns
 * a `DrillTo` + the clicked row into a concrete navigation target, casting against the real predicate
 * engine at that point. Kept in its own module (not report-catalogue.ts / widget-catalogue.ts) so both
 * catalogues can depend on it without a cross-import between them.
 */

/** One filter condition: mirrors the SPA predicate engine's `Predicate` shape (field/op/value). */
export interface DrillToCondition {
  /** Work-item field to filter on (e.g. "blocked", "status", "priority"). */
  field: string;
  /** Predicate operator — mirrors the SPA predicate engine's `Op` union (eq/ne/gt/gte/lt/lte/in/nin/
   *  truthy/falsy/negative/nonNegative). Kept as a plain string here; the SPA resolver casts it. */
  op: string;
  /** Literal comparison value baked into the descriptor. Unary ops (truthy/falsy/negative/nonNegative)
   *  ignore it. */
  value?: unknown;
}

/** A `DrillToCondition` whose value is read off the CLICKED data point instead of a literal — e.g.
 *  "filter to items whose `assignee` equals this row's `owner` field." Omit `fromField` to fall back to
 *  a literal `value` (a condition that doesn't vary per row). */
export interface DrillToFieldCondition extends DrillToCondition {
  /** Name of the field on the clicked data point to read the comparison value from — overrides `value`
   *  when present. */
  fromField?: string;
}

/** Mirrors the SPA predicate engine's `ConditionSet` (all-of AND, any-of OR; empty/absent ⇒ everything
 *  matches — but an empty `drillTo.predicate` with no `predicateFrom` either resolves to "no filter",
 *  which the SPA resolver refuses to turn into a drill-through). */
export interface DrillToConditionSet {
  all?: DrillToCondition[];
  any?: DrillToCondition[];
}

/** Declarative drill-down: turns a clicked data point on a report/widget into a navigation + a
 *  predicate against the work-item grid. */
export interface DrillTo {
  /** Where the drill-through lands. Only the project work-item grid exists today; kept an enum (not a
   *  bare string) so a future target doesn't change the descriptor shape. */
  target: "grid";
  /** Name of the field on the clicked data point that supplies the target project id — the grid is
   *  project-scoped. Omitted when the component rendering this is already project-scoped. */
  projectIdField?: string;
  /** Conditions ALWAYS applied, ANDed with any row-derived conditions in `predicateFrom`. */
  predicate?: DrillToConditionSet;
  /** Conditions derived from the clicked data point at click-time (e.g. "this row's status"), ANDed
   *  with `predicate`. */
  predicateFrom?: DrillToFieldCondition[];
  /** Human label for the resulting filter (e.g. "Blocked items"), shown in the grid's active-filter
   *  banner. Falls back to an auto-summary of the predicate when omitted. */
  label?: string;
}
