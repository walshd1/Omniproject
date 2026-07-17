import budgetPlans from "./screens/budget-plans.json";
import burndown from "./screens/burndown.json";
import explore from "./screens/explore.json";
import gantt from "./screens/gantt.json";
import home from "./screens/home.json";
import intake from "./screens/intake.json";
import kanban from "./screens/kanban.json";
import myWork from "./screens/my-work.json";
import prince2 from "./screens/prince2.json";
import programmeDetail from "./screens/programme-detail.json";
import programmes from "./screens/programmes.json";
import projectDetail from "./screens/project-detail.json";
import projectGantt from "./screens/project-gantt.json";
import projects from "./screens/projects.json";
import raciMatrix from "./screens/raci-matrix.json";
import raid from "./screens/raid.json";
import reports from "./screens/reports.json";
import resourceAllocations from "./screens/resource-allocations.json";
import riskRegister from "./screens/risk-register.json";
import scrum from "./screens/scrum.json";
import sprints from "./screens/sprints.json";
import stakeholders from "./screens/stakeholders.json";
import tasks from "./screens/tasks.json";
import userStories from "./screens/user-stories.json";

/**
 * THE SHIPPED SCREEN-DEFINITION catalogue — the panel-bearing screen ARTIFACTS the generic builder renders,
 * authored as pure JSON (NOT React). Relocated here from the SPA (roadmap X.11: "make screens … system JSON")
 * so there is ONE source of truth the BACKEND can seed into the read-only `system` def store AND the SPA can
 * render from — the ENGINE (the ScreenRenderer + panel components) stays in the app; only these definitions
 * are data. A screen is: an id + label + panels[{id, kind, config, …}] plus optional presentation metadata
 * (route/nav/hint/core/bare/methodologyLayouts) carried entirely in the JSON.
 *
 * Kept structurally loose here (the SPA casts to its full `ScreenDef` render model, and the backend seeds the
 * payload opaque-to-schema through `validateScreenDefs`); a drift test in the SPA validates the real shape.
 */
export interface RawScreenDef {
  id: string;
  label: string;
  panels: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** All shipped screen defs, in catalogue order (core pages first, then the methodology-shipped screens). */
export const SCREEN_DEF_CATALOGUE: RawScreenDef[] = [
  budgetPlans, resourceAllocations, home, myWork, tasks, reports, programmes, programmeDetail,
  projects, projectDetail, explore, kanban, scrum, sprints, userStories, burndown, gantt, prince2,
  raid, intake, projectGantt, riskRegister, raciMatrix, stakeholders,
] as unknown as RawScreenDef[];

/** The shipped screen defs (a fresh array each call, so a caller can't mutate the catalogue). */
export function screenDefCatalogue(): RawScreenDef[] {
  return [...SCREEN_DEF_CATALOGUE];
}
