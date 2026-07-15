import { METHODOLOGIES, type MethodologyDefinition } from "./methodology-catalogue";
import { matchesMethodology } from "./methodology-match";
import { reportsForMethodology, type ReportDefinition } from "./report-catalogue";
import { viewsForMethodology, type ViewDefinition } from "./view-catalogue";
import { screensForMethodology, type ScreenDefinition } from "./screen-catalogue";
import { outputsForMethodology, type OutputDefinition } from "./output-catalogue";
import { notificationRoutesForMethodology, type NotificationRoute } from "./notification-routing";

/**
 * GROUP any methodology-tagged definitions by methodology — generic over EVERY catalogue plane (reports,
 * views, screens, personas, …), since they all carry the same optional `methodologies` tag and share one
 * matcher. One bucket per methodology (in catalogue order); a bucket holds the defs that APPLY to it — those
 * carrying its tag PLUS neutral defs (untagged or `"*"`), which apply to all. So a def tagged
 * `["waterfall","prince2"]` appears under both, and a neutral def appears under every methodology. Pure and
 * artifact-agnostic (like the roll-up): a picker, a report, or an export renders the groups however it likes.
 */

export interface MethodologyGroup<T> {
  methodology: MethodologyDefinition;
  defs: T[];
}

/**
 * Bucket `defs` by methodology. Restrict to specific methodology ids with `opts.methodologies` (default: all,
 * in catalogue order). With `opts.nonEmpty`, methodologies that light up no def are dropped.
 */
export function groupByMethodology<T extends { methodologies?: string[] }>(
  defs: readonly T[],
  opts: { methodologies?: string[]; nonEmpty?: boolean } = {},
): Array<MethodologyGroup<T>> {
  const meths = opts.methodologies
    ? METHODOLOGIES.filter((m) => opts.methodologies!.includes(m.id))
    : METHODOLOGIES;
  const groups = meths.map((methodology) => ({
    methodology,
    defs: defs.filter((d) => matchesMethodology(d.methodologies, methodology.id)),
  }));
  return opts.nonEmpty ? groups.filter((g) => g.defs.length > 0) : groups;
}

/** The NEUTRAL defs — untagged or `"*"`, i.e. those that apply to every methodology (the "always shown" set). */
export function neutralDefs<T extends { methodologies?: string[] }>(defs: readonly T[]): T[] {
  return defs.filter((d) => !d.methodologies || d.methodologies.includes("*"));
}

/** Every artifact a methodology lights up, ACROSS the methodology-tagged planes (reports + views + screens).
 *  Each list holds that plane's defs carrying the tag PLUS the neutral (always-on) ones. This is the "select
 *  Agile → preload all the Agile artifacts" bundle — one call instead of a per-plane filter each time. */
export interface MethodologyArtifacts {
  reports: ReportDefinition[];
  views: ViewDefinition[];
  screens: ScreenDefinition[];
  outputs: OutputDefinition[];
  /** Notification ROUTES canonical to the methodology (ceremony reminders, stage-gate alerts, …). Notifs
   *  are methodology-canonical only where a route is tagged; most are neutral and route regardless. */
  notifications: NotificationRoute[];
}

export function artifactsForMethodology(methodology: string): MethodologyArtifacts {
  return {
    reports: reportsForMethodology(methodology),
    views: viewsForMethodology(methodology),
    screens: screensForMethodology(methodology),
    outputs: outputsForMethodology(methodology),
    notifications: notificationRoutesForMethodology(methodology),
  };
}
