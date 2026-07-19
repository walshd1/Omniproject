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

/**
 * Run a consolidation spec (by id) over the projects: group them by programme, and let the engine extract +
 * consolidate the spec's measures. Returns the generic consolidated rows — a report binds its columns to the
 * metric keys the spec declares.
 */
export function rollupBySpec(
  specId: string,
  projects: ProjectItems[],
  reportingCurrency: string,
  rates?: Record<string, number>,
): { programmes: ConsolidatedRow[]; portfolio: ConsolidatedRow } {
  const spec = consolidationSpec(specId);
  const inputs: ConsolidationInput[] = projects.map((p) => ({
    groupKey: p.programmeId ?? STANDALONE,
    groupLabel: p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone",
    currency: p.currency,
    items: p.items as unknown as Record<string, unknown>[],
  }));
  const { groups, total } = consolidateByGroup(inputs, spec, reportingCurrency, rates);
  return { programmes: groups, portfolio: total };
}
