import { type ReportDefinition } from "@workspace/backend-catalogue";
import { configResource } from "./config-resource";

/**
 * Built-in report metadata overrides. Presentation-only: a per-report-id override of label / order /
 * visibility, merged over the shipped catalogue so a customer can rename, reorder or hide a built-in
 * report without a rebuild. Never changes rendering (that's code) or data. PMO-gated write; anyone reads.
 */
export interface ReportOverride {
  id: string;
  label?: string;
  order?: number;
  hidden?: boolean;
}

/** A catalogue report with its override applied, plus the resolved `hidden` flag. */
export interface MergedReport extends ReportDefinition {
  hidden: boolean;
}

/** Apply overrides (label/order/hidden) over the catalogue and return it sorted by effective order. */
export function mergeReportOverrides(
  catalogue: ReportDefinition[],
  overrides: readonly ReportOverride[],
): MergedReport[] {
  const byId = new Map(overrides.map((o) => [o.id, o]));
  return catalogue
    .map((r) => {
      const o = byId.get(r.id);
      return {
        ...r,
        label: o?.label && o.label.trim() ? o.label : r.label,
        order: o?.order ?? r.order,
        hidden: o?.hidden ?? false,
      };
    })
    .sort((a, b) => a.order - b.order);
}

export const reportOverridesQueryKey = ["report-overrides"] as const;

const resource = configResource<ReportOverride[]>({
  queryKey: reportOverridesQueryKey,
  path: "/api/reports/overrides",
  envelopeKey: "reportOverrides",
  reconcile: "set-from-response", // pmo-gated; the endpoint echoes the saved list back
});
/** The saved built-in report overrides. */
export const useReportOverrides = resource.useResource;
/** Persist the built-in report overrides (pmo). */
export const useSaveReportOverrides = resource.useSaveResource;
