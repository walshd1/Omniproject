/**
 * Single source of truth for primary navigation. Both the sidebar (AppLayout)
 * and the command palette render from this list so the two can never drift.
 *
 * `i18nKey` resolves through useT(); `match` decides the sidebar active state.
 */
import { Layers, Briefcase, BarChart3, FlaskConical, Settings as SettingsIcon, PlugZap, Boxes, Users, type LucideIcon } from "lucide-react";
import { useGetCapabilities } from "@workspace/api-client-react";
import { canSurfaceEntity } from "./capabilities-fields";

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
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", i18nKey: "nav.dashboard", label: "Dashboard", icon: Layers, chord: "G+D", match: (l) => l === "/" },
  { href: "/programmes", i18nKey: "nav.programmes", label: "Programmes", icon: Boxes, match: (l) => l.startsWith("/programmes"), requiresEntity: "programme" },
  { href: "/projects", i18nKey: "nav.projects", label: "Projects", icon: Briefcase, chord: "G+P", match: (l) => l.startsWith("/projects") },
  { href: "/reports", i18nKey: "nav.reports", label: "Reports", icon: BarChart3, chord: "G+R", match: (l) => l.startsWith("/reports") },
  { href: "/resources", i18nKey: "nav.resources", label: "Resources", icon: Users, match: (l) => l.startsWith("/resources"), requiresEntity: "member" },
  { href: "/explore", i18nKey: "nav.explore", label: "Explore", icon: FlaskConical, chord: "G+E", match: (l) => l.startsWith("/explore") },
  { href: "/settings", i18nKey: "nav.settings", label: "Settings", icon: SettingsIcon, chord: "G+S", match: (l) => l.startsWith("/settings") },
  { href: "/setup", i18nKey: "nav.setup", label: "Setup", icon: PlugZap, match: (l) => l.startsWith("/setup") },
];

/**
 * Nav items the active backend can actually surface — drops entity-gated items
 * (e.g. Programmes) when the backend has no field to carry them. Permissive
 * while capabilities load.
 */
export function useVisibleNavItems(): NavItem[] {
  const { data: caps } = useGetCapabilities();
  return NAV_ITEMS.filter((item) => !item.requiresEntity || canSurfaceEntity(caps, item.requiresEntity));
}
