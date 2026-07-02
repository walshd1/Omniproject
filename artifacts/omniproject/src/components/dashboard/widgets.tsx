import { useMemo, type ComponentType } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useQueries } from "@tanstack/react-query";
import {
  useListProjects,
  useListProgrammes,
  useListActivity,
  getGetProjectCapacityQueryOptions,
  getGetProjectIssuesQueryOptions,
  type ResourceCapacity,
  type Issue,
} from "@workspace/api-client-react";
import { PortfolioKpi } from "../reports/PortfolioKpi";
import { PortfolioTrends } from "../reports/PortfolioTrends";
import { deriveCapacityActuals, type ResourceActual } from "../../lib/capacity-actuals";
import { statusLabel } from "../../lib/constants";

/**
 * Dashboard widget registry — maps each catalogue `type` (lib/dashboards WIDGET_CATALOGUE) to a
 * self-contained React component. Every widget reads through the existing read-model hooks; none
 * takes required props, so a dashboard can place any of them in any order. Unknown types render a
 * small placeholder (a removed/renamed widget never breaks a saved dashboard).
 */

function StatCard({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const inner = (
    <div className="bg-card border-2 border-foreground p-4 h-full flex flex-col justify-between">
      <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-4xl font-black tabular-nums">{value}</div>
    </div>
  );
  return href ? <Link href={href} className="block h-full hover:opacity-80 transition-opacity">{inner}</Link> : inner;
}

function ProjectCountWidget() {
  const { data: projects } = useListProjects();
  return <StatCard label="Projects" value={projects?.length ?? "—"} href="/projects" />;
}

function ProgrammeCountWidget() {
  const { data: programmes } = useListProgrammes();
  return <StatCard label="Programmes" value={programmes?.length ?? "—"} href="/programmes" />;
}

function StatusBreakdownWidget() {
  const { data: projects } = useListProjects();
  const counts = new Map<string, number>();
  for (const p of projects ?? []) {
    const s = (p as { status?: string }).status ?? "unknown";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="bg-card border-2 border-foreground p-4 h-full">
      <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">Status breakdown</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map(([status, n]) => (
            <li key={status} className="flex items-center justify-between">
              <span>{statusLabel(status)}</span>
              <span className="font-mono font-bold tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentActivityWidget() {
  const { data: activity } = useListActivity();
  return (
    <div className="bg-card border-2 border-foreground p-4 h-full">
      <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">Recent activity</div>
      {!activity?.length ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="space-y-3">
          {activity.slice(0, 8).map((entry) => (
            <li key={entry.id} className="text-sm border-l-2 border-primary pl-3">
              <div className="text-muted-foreground text-xs font-mono">{format(new Date(entry.timestamp), "MMM dd, HH:mm")}</div>
              <div className="font-bold">{entry.actor} {entry.action.replace(/_/g, " ")}</div>
              {entry.issueTitle && <div className="text-muted-foreground truncate">{entry.issueTitle}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Colour the delivery figure by band: over (red), under (amber), on-track/no-plan (muted). */
function deliveryColor(state: string): string {
  if (state === "OVER_DELIVERED") return "text-red-500";
  if (state === "UNDER_DELIVERED") return "text-amber-500";
  return "text-muted-foreground";
}

function CapacityActualsWidget() {
  const { data: projects } = useListProjects();
  const ids = useMemo(() => (projects ?? []).map((p) => p.id), [projects]);

  const capacityQueries = useQueries({ queries: ids.map((id) => getGetProjectCapacityQueryOptions(id)) });
  const issueQueries = useQueries({ queries: ids.map((id) => getGetProjectIssuesQueryOptions(id)) });

  const summary = useMemo(() => {
    const plan = capacityQueries.flatMap((q) => (q.data as ResourceCapacity[] | undefined) ?? []);
    const actuals: ResourceActual[] = issueQueries
      .flatMap((q) => (q.data as Issue[] | undefined) ?? [])
      .filter((i) => typeof i.loggedHours === "number" && i.loggedHours > 0 && i.assignee)
      .map((i) => ({ resourceId: i.assignee, resourceName: i.assignee, loggedHours: i.loggedHours ?? 0 }));
    return deriveCapacityActuals(plan, actuals);
  }, [capacityQueries, issueQueries]);

  const rows = summary.rows.slice(0, 6);
  return (
    <div className="bg-card border-2 border-foreground p-4 h-full">
      <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">Capacity actuals vs plan</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No capacity or logged-time data to compare.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-black tabular-nums">
              {summary.overallDeliveryPercentage === null ? "—" : `${summary.overallDeliveryPercentage}%`}
            </span>
            <span className="text-xs text-muted-foreground">
              {summary.totalLoggedHours.toLocaleString()}h logged / {summary.totalPlannedHours.toLocaleString()}h planned
            </span>
          </div>
          <ul className="space-y-1.5 text-sm">
            {rows.map((r) => (
              <li key={r.resourceId} className="flex items-center justify-between gap-2" data-testid={`capacity-actuals-row-${r.resourceId}`}>
                <span className="truncate">{r.resourceName || r.resourceId}</span>
                <span className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                  <span className="text-muted-foreground">{r.loggedHours}h/{r.plannedHours}h</span>
                  <span className={`font-black ${deliveryColor(r.state)}`}>
                    {r.varianceHours > 0 ? "+" : ""}{r.varianceHours}h
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UnknownWidget({ type }: { type: string }) {
  return (
    <div className="bg-card border-2 border-dashed border-muted-foreground/40 p-4 h-full text-sm text-muted-foreground">
      Unknown widget “{type}”. It may have been removed in a newer version.
    </div>
  );
}

/** type → component. Components are self-contained (no required props). */
export const WIDGET_COMPONENTS: Record<string, ComponentType> = {
  portfolioHealth: PortfolioKpi,
  portfolioTrends: PortfolioTrends,
  recentActivity: RecentActivityWidget,
  projectCount: ProjectCountWidget,
  programmeCount: ProgrammeCountWidget,
  statusBreakdown: StatusBreakdownWidget,
  capacityActuals: CapacityActualsWidget,
};

/** Render a widget by type, falling back to a placeholder for an unknown type. */
export function WidgetView({ type }: { type: string }) {
  const Component = WIDGET_COMPONENTS[type];
  return Component ? <Component /> : <UnknownWidget type={type} />;
}
