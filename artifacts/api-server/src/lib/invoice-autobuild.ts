import type { Request } from "express";
import { round2 } from "@workspace/backend-catalogue";
import { getProjects } from "./data";
import { programmeIdOf } from "./programmes";
import { staffCost, type StaffCost, type TimedItem } from "./rate-card";
import { getRateCard, getIdentityMap, projectTypeFor, resolveUplift, getCostRules } from "./rate-card-store";
import { applyCostRules } from "./cost-rules";
import { timesheetStoreFor } from "../timesheets/store";
import { approvedHoursByResource } from "../timesheets/actuals";

/**
 * Invoice auto-build (Invoice Ninja phase 3) — seed a DRAFT invoice's LABOUR lines from a project's
 * APPROVED timesheets × the PMO rate card, reusing the exact staff-cost roll-up the
 * `/projects/:id/staff-cost` route computes (same uplift assembly: central → programme → project,
 * then the PMO cost rules). Nothing is stored here; the caller sanitises + persists the draft, which
 * the manager can then edit and push to Invoice Ninja via `/invoices/:id/push`.
 *
 * Billing semantics: approved time is BILLED to the client, so items are client-facing and staffCost
 * resolves the charge-out rate (cost + overhead + margin) — `byTitle.charge` is the amount per role.
 * (Contrast `approvedItemsFrom`, which marks the same hours INTERNAL for the cost-vs-actuals comparison.)
 * Expense/fixed/discount lines are not auto-derived — there is no expense actuals source — so the
 * manager adds those on the editable draft.
 */

/** Approved hours per resource as CLIENT-FACING timed items (billable), so `staffCost` resolves the
 *  client charge-out rate — the amount to invoice. */
export function billableItemsFrom(byResource: Record<string, number>): TimedItem[] {
  return Object.entries(byResource).map(([assignee, loggedHours]) => ({ assignee, loggedHours, billable: true }));
}

/**
 * Client-facing staff-cost roll-up for a project from its APPROVED timesheets, or null when no
 * timesheet store is configured for the scope. Mirrors the staff-cost route's uplift assembly so the
 * invoiced charge matches what the PMO cost view reports.
 */
export async function billableStaffCostForProject(req: Request, projectId: string): Promise<StaffCost | null> {
  const projects = await getProjects(req);
  const project = (projects.find((p) => String(p["id"]) === projectId) ?? {}) as Record<string, unknown>;
  const programmeId = programmeIdOf(project);
  const scope = { programmeId, projectId };
  const tsStore = timesheetStoreFor(scope);
  if (!tsStore) return null;

  const projectType = projectTypeFor(projectId);
  // The cost-rule context: scope + projectType + every scalar project attribute (so a rule can match
  // on region, intraCompany, a custom flag, …), exactly as the staff-cost route builds it.
  const ctx: Record<string, unknown> = { programmeId, projectId, projectType };
  for (const [k, v] of Object.entries(project)) if (v == null || typeof v !== "object") ctx[k] = v;
  const uplift = applyCostRules(resolveUplift(scope), getCostRules(), ctx);

  const items = billableItemsFrom(await approvedHoursByResource(tsStore, projectId));
  return staffCost(items, getRateCard(), getIdentityMap(), projectType, uplift, scope);
}

/** A server-built DRAFT labour line (before the invoice sanitiser derives its amount). */
export interface DraftLabourLine {
  kind: "labour";
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * One DRAFT labour line per costed role: `quantity` = hours, `unitPrice` = charge / hours (2dp); the
 * invoice sanitiser re-derives the line amount. Roles with no charge or no hours (unrated / internal-
 * only) are skipped, so unbillable time never lands on the invoice.
 */
export function labourLinesFromStaffCost(cost: StaffCost): DraftLabourLine[] {
  const lines: DraftLabourLine[] = [];
  for (const row of cost.byTitle) {
    if (row.hours <= 0 || row.charge <= 0) continue;
    const hours = round2(row.hours);
    lines.push({
      kind: "labour",
      description: `${row.titleLabel} — labour (${hours}h)`,
      quantity: hours,
      unitPrice: round2(row.charge / row.hours),
    });
  }
  return lines;
}
