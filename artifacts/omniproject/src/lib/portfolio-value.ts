import { consolidateByGroup, consolidationSpec, type ConsolidatedRow, type ConsolidationInput } from "@workspace/backend-catalogue";
import type { IncomeInput } from "./income";
import type { BenefitInput } from "./benefits";

/**
 * Portfolio value roll-ups — consolidate each project's per-item figures into one reporting currency and
 * group by programme. There is no income- or benefit-specific code here: which fields to sum, the derived
 * metric and the sort ALL live in the JSON consolidation spec (assets/consolidations/), and the generic
 * `consolidateByGroup` engine reads them. This module only maps a project to a group (programme, or
 * standalone) and hands its raw items to the engine. Pure and derive-only: nothing is stored.
 */

/** One project's work items, tagged with its programme + currency for grouping and conversion. The item
 *  type carries the income/benefit fields the shipped specs read (and that the detail reports also use);
 *  the consolidation engine itself only ever sees them as generic records. */
export interface ProjectItems {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  currency: string;
  items: (IncomeInput & BenefitInput)[];
}

const STANDALONE = "__standalone__";

/** The level a value roll-up groups its rows at — the SAME consolidation, only the grouping of the data
 *  changes (income, benefits and costs are all this pattern at any of these scopes). */
export type RollupScope = "project" | "programme" | "org";

/** Which group a project belongs to at a given scope. The grand total (`portfolio`) is the org figure
 *  regardless of scope. */
function groupOf(p: ProjectItems, scope: RollupScope): { key: string; label: string } {
  switch (scope) {
    case "project":
      return { key: p.projectId, label: p.projectName };
    case "org":
      return { key: "__org__", label: "Organisation" };
    case "programme":
    default:
      return { key: p.programmeId ?? STANDALONE, label: p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone" };
  }
}

/**
 * Run a consolidation spec (by id) over the projects at a given scope: group them (by project / programme /
 * org), and let the engine extract + consolidate the spec's measures. Income, benefits and costs are the same
 * call, differing only in `specId`; project/programme/org are the same call, differing only in `scope`.
 * Returns the generic consolidated rows (`programmes`, kept named for the callers) + the org grand total.
 */
export function rollupBySpec(
  specId: string,
  projects: ProjectItems[],
  reportingCurrency: string,
  rates?: Record<string, number>,
  scope: RollupScope = "programme",
): { programmes: ConsolidatedRow[]; portfolio: ConsolidatedRow } {
  const spec = consolidationSpec(specId);
  const inputs: ConsolidationInput[] = projects.map((p) => {
    const g = groupOf(p, scope);
    return { groupKey: g.key, groupLabel: g.label, currency: p.currency, items: p.items as unknown as Record<string, unknown>[] };
  });
  const { groups, total } = consolidateByGroup(inputs, spec, reportingCurrency, rates);
  return { programmes: groups, portfolio: total };
}
