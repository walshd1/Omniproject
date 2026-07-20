import { canonicalLayoutFor, screenIsCore } from "../lib/screen-catalogue";
import { useScreenDef } from "../lib/org-screens";
import { useDisabledScreens, isScreenDisabled } from "../lib/screen-state";
import type { ScreenDef } from "../lib/screen";
import { EditableScreen } from "../components/screen/EditableScreen";

/**
 * ScreenPage — the ONE generic builder page behind every editable screen. Given a screen `id`, it loads
 * that screen's JSON definition from the catalogue and renders it through the EditableScreen canvas: the
 * renderer imports the panel primitives, configures each from the JSON (columns, span, data `source`,
 * methodology tags), and each primitive then loads its own data. Adding or changing a screen is therefore a
 * JSON edit plus a route pointing here at its id — no bespoke page code.
 *
 * `bare` screens (a single hosted full-page component) render full-bleed, without ScreenPage's own header,
 * so a migrated page looks exactly as it did. `params` (route params) are threaded onto every panel's
 * config, so a `component`-hosted detail page receives its projectId / programmeId.
 *
 * Capability gating (hiding a panel whose backend domain isn't fed) is threaded per-panel via each panel's
 * `needs` tag; the current screens declare none, so caps aren't wired here yet — that adapter lands with the
 * first screen that needs it.
 */
export function ScreenPage({ id, methodology, params }: { id: string; methodology?: string; params?: Record<string, string> }) {
  const def = useScreenDef(id);
  const { data: disabled } = useDisabledScreens();

  // A core screen can never be turned off, even if its id somehow appears in the disabled list.
  if (!screenIsCore(id) && isScreenDisabled(disabled, id)) {
    return (
      <div className="p-8 text-sm text-muted-foreground" data-testid={`screen-off-${id}`}>
        This screen has been turned off for your organisation. An admin or PMO can re-enable it under
        Settings → Screens.
      </div>
    );
  }

  if (!def) {
    return (
      <div className="p-8 text-sm text-muted-foreground" data-testid={`screen-unknown-${id}`}>
        Unknown screen “{id}”. It may have been removed or renamed.
      </div>
    );
  }

  // Thread the screen id (so a panel can scope its saved views) and route params (projectId / programmeId /
  // … so a hosted component receives them) onto every panel's config. The JSON stays param-free; these are
  // supplied live at render. `__screenId` is namespaced so it never collides with a data field.
  const screen: ScreenDef = {
    ...def,
    panels: def.panels.map((p) => ({ ...p, config: { ...(p.config ?? {}), __screenId: id, ...(params ?? {}) } })),
  };

  // A methodology-tagged screen (e.g. the Kanban board) renders with ITS OWN methodology by default — so
  // its content is filtered and its canonical layout applies without a caller having to pass one. An
  // explicit `methodology` prop still wins. Neutral ("*") tags don't select a methodology.
  const activeMethodology = methodology ?? def.methodologies?.find((m) => m !== "*");

  // The methodology's canonical arrangement (if it ships one) becomes the layout fallback beneath any
  // customer-saved layout; content is filtered by the same methodology inside the renderer.
  const fallbackLayout = canonicalLayoutFor(def, activeMethodology);

  if (def.bare) {
    // A bare screen renders full-bleed without ScreenPage's visible header, but every page still needs
    // exactly ONE top-level heading — for accessibility and because the route smoke asserts a single
    // visible <h1>. A `component`-hosted bare screen (Home, Projects, …) delegates to a full-page
    // component that already renders its own <h1>; a `view`/panel-hosted bare screen (Gantt, Kanban,
    // the methodology boards, …) has no such heading, so supply a screen-reader-only page title here —
    // naming the page for assistive tech without altering the full-bleed layout, and without doubling
    // up the heading on the component-hosted screens.
    const hostsOwnHeading = screen.panels.some((p) => p.kind === "component");
    return (
      <div className="h-full" data-testid={`screen-${id}`}>
        {!hostsOwnHeading && <h1 className="sr-only">{def.label}</h1>}
        <EditableScreen screen={screen} bare fallbackLayout={fallbackLayout} {...(activeMethodology ? { methodology: activeMethodology } : {})} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid={`screen-${id}`}>
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter">{def.label}</h1>
        {def.hint && <span className="text-xs text-muted-foreground">{def.hint}</span>}
      </div>
      <div className="flex-1 p-8 overflow-auto">
        <EditableScreen screen={screen} fallbackLayout={fallbackLayout} {...(activeMethodology ? { methodology: activeMethodology } : {})} />
      </div>
    </div>
  );
}
