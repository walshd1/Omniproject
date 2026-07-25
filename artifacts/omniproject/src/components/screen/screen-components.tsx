import { lazy, type ComponentType } from "react";

/**
 * Screen-component registry — the bridge that lets a JSON screen host a full existing SPA page/component
 * as a `component` panel, the same idea as ViewPanel hosting a methodology view. It exists for the cases
 * where a page's bespoke, interactive UX (selectors, quick-add forms, tabbed inboxes, methodology-gated
 * report sections) can't be reproduced by the generic table/chart/view primitives without regressing
 * behaviour: rather than rewrite it, the screen references the component by id and it renders UNCHANGED.
 *
 * Entries are React.lazy so each page stays its own code-split chunk (no eager import graph, and no cycle
 * with ScreenPage, which is itself a page). Config on the panel is passed through as props, so a route
 * param (projectId / programmeId) threaded onto the panel reaches the hosted component.
 */
export type ScreenComponentProps = { projectId?: string; programmeId?: string };

export const SCREEN_COMPONENTS: Record<string, ComponentType<ScreenComponentProps>> = {
  home: lazy(() => import("../../modules/shell/Home").then((m) => ({ default: m.Home as ComponentType<ScreenComponentProps> }))),
  "my-work": lazy(() => import("../../modules/shell/MyWork").then((m) => ({ default: m.MyWork as ComponentType<ScreenComponentProps> }))),
  tasks: lazy(() => import("../../modules/shell/Tasks").then((m) => ({ default: m.Tasks as ComponentType<ScreenComponentProps> }))),
  reports: lazy(() => import("../../modules/shell/Reports").then((m) => ({ default: m.Reports as ComponentType<ScreenComponentProps> }))),
  programmes: lazy(() => import("../../modules/shell/Programmes").then((m) => ({ default: m.Programmes as ComponentType<ScreenComponentProps> }))),
  "programme-detail": lazy(() => import("../../modules/shell/ProgrammeDetail").then((m) => ({ default: m.ProgrammeDetail as ComponentType<ScreenComponentProps> }))),
  projects: lazy(() => import("../../modules/shell/Projects").then((m) => ({ default: m.Projects as ComponentType<ScreenComponentProps> }))),
  "project-detail": lazy(() => import("../../modules/shell/ProjectDetail").then((m) => ({ default: m.ProjectDetail as ComponentType<ScreenComponentProps> }))),
  explore: lazy(() => import("../../modules/shell/Explore").then((m) => ({ default: m.Explore as ComponentType<ScreenComponentProps> }))),
  burndown: lazy(() => import("../methodology/BurndownScreen").then((m) => ({ default: m.BurndownScreen as ComponentType<ScreenComponentProps> }))),
};

/** Whether a screen component is registered for this id. */
export function hasScreenComponent(id: string): boolean {
  return id in SCREEN_COMPONENTS;
}

/** The registered component ids (for the screen editor's `component`-panel picker). */
export const SCREEN_COMPONENT_IDS: string[] = Object.keys(SCREEN_COMPONENTS);
