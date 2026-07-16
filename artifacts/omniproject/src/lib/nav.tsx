/**
 * Single source of truth for primary navigation. Both the sidebar (AppLayout)
 * and the command palette render from this list so the two can never drift.
 *
 * `i18nKey` resolves through useT(); `match` decides the sidebar active state.
 *
 * Progressive disclosure: every item belongs to a `group`. "primary" items are
 * the everyday overworked-PM surfaces (what-needs-me, projects, reports…) shown
 * to every role. "admin" items are the heavy governance/config surfaces; they
 * stay hidden behind a collapsed "Advanced" area for plain PMs, and are shown
 * openly only to the roles that own them (admin / PMO) — or when a viewer opts
 * in via the explicit "show advanced" toggle. Nothing is REMOVED: deep-links
 * still resolve for authorised users; we only gate VISIBILITY in the chrome.
 *
 * That's a SOFT declutter (still reachable via "show advanced"). A `visibleToRoles`
 * item is a HARD gate on top: a role that fails it never sees the item at all, in
 * either shelf or the command palette — for surfaces a role isn't just deprioritised
 * from but genuinely shouldn't be browsing (e.g. the Configurator, which reads live
 * broker/backend state a plain contributor has no reason to poke at even read-only).
 */
import { Layers, Briefcase, BarChart3, FlaskConical, Settings as SettingsIcon, PlugZap, Boxes, Users, Inbox, LayoutDashboard, FileText, BookOpen, PenTool, ListChecks, Wallet, Columns3, type LucideIcon } from "lucide-react";
import { useGetCapabilities } from "@workspace/api-client-react";
import { canSurfaceEntity } from "./capabilities-fields";
import { useFeatures, featureEnabled } from "./features";
import { useAuth, isPmoOrAdmin, type Role } from "./auth";
import { useMethodologyComposition } from "./methodology-composition-api";
import { visibleRoutedScreens, screenVisibleUnder, type ScreenCatalogueEntry } from "./screen-catalogue";
import { useRoutedScreens } from "./org-screens";
import { useDisabledScreens, isScreenDisabled } from "./screen-state";

/** Which shelf a nav item lives on. "admin" items are collapsed behind the Advanced gate. */
export type NavGroup = "primary" | "admin";

export interface NavItem {
  href: string;
  /** Translation key (see lib/i18n.tsx). */
  i18nKey: string;
  /** Fallback English label for non-i18n contexts (e.g. command palette search). */
  label: string;
  icon: LucideIcon;
  /** Sidebar chord hint shown on the right (e.g. "G+D"); omit for none. */
  chord?: string;
  /** Whether the given location should mark this item active. */
  match: (location: string) => boolean;
  /** If set, only show this item when the backend can surface that entity. */
  requiresEntity?: string;
  /** If set, only show this item when that feature module is enabled. */
  requiresFeature?: string;
  /** If set, a HARD visibility gate: a role that fails it never sees this item at
   *  all (sidebar or command palette), not even collapsed behind "show advanced". */
  visibleToRoles?: (role: Role | undefined) => boolean;
  /** Which shelf this item lives on. Defaults to "primary". */
  group?: NavGroup;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", i18nKey: "nav.dashboard", label: "Dashboard", icon: Layers, chord: "G+D", match: (l) => l === "/", group: "primary" },
  { href: "/my-work", i18nKey: "nav.myWork", label: "My Work", icon: Inbox, match: (l) => l.startsWith("/my-work"), requiresFeature: "myWork", group: "primary" },
  { href: "/tasks", i18nKey: "nav.tasks", label: "Tasks", icon: ListChecks, match: (l) => l.startsWith("/tasks"), group: "primary" },
  { href: "/dashboards", i18nKey: "nav.dashboards", label: "Dashboards", icon: LayoutDashboard, match: (l) => l.startsWith("/dashboards"), requiresFeature: "dashboards", group: "primary" },
  { href: "/content", i18nKey: "nav.content", label: "Content", icon: FileText, match: (l) => l.startsWith("/content"), requiresFeature: "contentPages", group: "primary" },
  { href: "/wiki", i18nKey: "nav.wiki", label: "Wiki", icon: BookOpen, match: (l) => l.startsWith("/wiki"), group: "primary" },
  { href: "/whiteboards", i18nKey: "nav.whiteboards", label: "Whiteboards", icon: PenTool, match: (l) => l.startsWith("/whiteboards"), requiresFeature: "whiteboard", group: "primary" },
  { href: "/programmes", i18nKey: "nav.programmes", label: "Programmes", icon: Boxes, match: (l) => l.startsWith("/programmes"), requiresEntity: "programme", group: "primary" },
  { href: "/projects", i18nKey: "nav.projects", label: "Projects", icon: Briefcase, chord: "G+P", match: (l) => l.startsWith("/projects"), group: "primary" },
  { href: "/budgets", i18nKey: "nav.budgets", label: "Budgets", icon: Wallet, match: (l) => l.startsWith("/budgets"), group: "primary" },
  { href: "/reports", i18nKey: "nav.reports", label: "Reports", icon: BarChart3, chord: "G+R", match: (l) => l.startsWith("/reports"), group: "primary" },
  { href: "/resources", i18nKey: "nav.resources", label: "Resources", icon: Users, match: (l) => l.startsWith("/resources"), requiresEntity: "member", group: "primary" },
  { href: "/resource-planning", i18nKey: "nav.resourcePlanning", label: "Resource planning", icon: Users, match: (l) => l.startsWith("/resource-planning"), group: "primary" },
  { href: "/explore", i18nKey: "nav.explore", label: "Explore", icon: FlaskConical, chord: "G+E", match: (l) => l.startsWith("/explore"), group: "admin" },
  { href: "/settings", i18nKey: "nav.settings", label: "Settings", icon: SettingsIcon, chord: "G+S", match: (l) => l.startsWith("/settings"), group: "admin" },
  { href: "/configurator", i18nKey: "nav.configurator", label: "Configurator", icon: PlugZap, chord: "G+C", match: (l) => l.startsWith("/configurator") || l.startsWith("/setup"), group: "admin", visibleToRoles: isPmoOrAdmin },
];

/** An item's group, defaulting to "primary" when unset. */
export function navGroupOf(item: NavItem): NavGroup {
  return item.group ?? "primary";
}

/**
 * Does this role get the Admin/Advanced shelf shown open by default? The heavy
 * governance surfaces belong to the authorities that own them — admin and PMO.
 * Everyone else keeps them collapsed behind the explicit "show advanced" toggle.
 * Pure function (no hooks) so it's trivially unit-testable per role.
 */
export function roleSeesAdminByDefault(role: Role | undefined): boolean {
  return isPmoOrAdmin(role);
}

/**
 * Split a list of nav items into the two shelves. Pure — the caller supplies the
 * already entity/feature-filtered list so this stays about grouping only.
 */
export function partitionNavByGroup(items: NavItem[]): { primary: NavItem[]; admin: NavItem[] } {
  const primary: NavItem[] = [];
  const admin: NavItem[] = [];
  for (const item of items) {
    (navGroupOf(item) === "admin" ? admin : primary).push(item);
  }
  return { primary, admin };
}

/**
 * The nav shelves a role actually sees, given whether the Advanced area is
 * expanded. Primary is always visible. Admin items are visible when the role
 * owns them (admin/PMO) OR the user has expanded the Advanced toggle. Pure so
 * the decision is covered by unit tests for each role.
 */
export function navShelvesForRole(
  items: NavItem[],
  role: Role | undefined,
  advancedExpanded: boolean,
): { primary: NavItem[]; admin: NavItem[]; adminVisible: boolean } {
  const { primary, admin } = partitionNavByGroup(items);
  const adminVisible = roleSeesAdminByDefault(role) || advancedExpanded;
  return { primary, admin, adminVisible };
}

/**
 * Nav items the active backend can actually surface AND this role may see at all —
 * drops entity-gated items (e.g. Programmes) when the backend has no field to carry
 * them, feature-gated items whose module is off, and any `visibleToRoles` item this
 * role fails (a hard gate, unlike the soft admin-shelf declutter `useNavShelves`
 * applies on top of this for the surfaces that stay reachable either way).
 * Permissive while capabilities/auth load. Shared by the sidebar AND the command
 * palette, so a hard-gated item can't be found through search either.
 */
export function useVisibleNavItems(): NavItem[] {
  const { data: caps } = useGetCapabilities();
  const { data: features } = useFeatures();
  const { data: auth } = useAuth();
  const { data: composition } = useMethodologyComposition();
  const { data: disabled } = useDisabledScreens();
  // The EFFECTIVE routed screens (built-in + the org's stored/overridden ones), gated by the composition
  // and the admin OFF switch.
  const routed = useRoutedScreens();
  const staticItems = NAV_ITEMS.filter(
    (item) =>
      (!item.requiresEntity || canSurfaceEntity(caps, item.requiresEntity)) &&
      (!item.requiresFeature || featureEnabled(features, item.requiresFeature)) &&
      (!item.visibleToRoles || item.visibleToRoles(auth?.role)),
  );
  const composed = composition ?? null;
  const screenItems = routed
    .filter((s) => !isScreenDisabled(disabled, s.id) && screenVisibleUnder(composed, s))
    .map(screenToNavItem);
  return [...staticItems, ...screenItems];
}

/** Map a routed catalogue screen to a nav item. Catalogue labels come from their JSON (not the i18n dict),
 *  so the label doubles as the i18n key — translate() returns it verbatim (no ugly fallback), still
 *  override-able by adding a matching key. Icon is a generic board glyph. */
function screenToNavItem(s: ScreenCatalogueEntry): NavItem {
  const label = s.nav?.label ?? s.label;
  return {
    href: s.route!,
    i18nKey: label,
    label,
    icon: Columns3,
    match: (l: string) => l.startsWith(s.route!),
    group: s.nav?.group ?? "primary",
  };
}

/**
 * Nav items for the BUILT-IN routed screens visible under a composition (pure; used in tests and as the
 * org-independent baseline). The live nav (useVisibleNavItems) additionally merges the org's stored screens.
 */
export function catalogueScreenNavItems(composition: Parameters<typeof visibleRoutedScreens>[0]): NavItem[] {
  return visibleRoutedScreens(composition).map(screenToNavItem);
}

/**
 * Role-aware nav shelves for the current session. Combines the backend/feature
 * filter with the current role and the caller-owned "show advanced" toggle.
 */
export function useNavShelves(advancedExpanded: boolean): {
  primary: NavItem[];
  admin: NavItem[];
  adminVisible: boolean;
} {
  const items = useVisibleNavItems();
  const { data: auth } = useAuth();
  return navShelvesForRole(items, auth?.role, advancedExpanded);
}
