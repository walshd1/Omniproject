/**
 * Route-coverage manifest. Every client route declared in `src/App.tsx` (`path="…"`) must appear
 * here exactly once — the `guard-e2e-routes` script fails CI otherwise, so a new page can't ship
 * without an end-to-end smoke. `path` is a concrete URL (params filled from deterministic demo
 * data) that the smoke spec actually visits.
 */
export interface RouteCase {
  /** Exactly as written in App.tsx `path="…"`. */
  pattern: string;
  /** Concrete URL the smoke spec navigates to. */
  path: string;
  /** Whether a demo session must be established first (default true). */
  needsAuth?: boolean;
  /** True for the unauthenticated login screen (asserted differently — no app <h1>). */
  isLogin?: boolean;
}

export const ROUTES: RouteCase[] = [
  { pattern: "/", path: "/" },
  { pattern: "/my-work", path: "/my-work" },
  { pattern: "/tasks", path: "/tasks" },
  { pattern: "/dashboards", path: "/dashboards" },
  { pattern: "/content", path: "/content" },
  { pattern: "/wiki", path: "/wiki" },
  { pattern: "/whiteboards", path: "/whiteboards" },
  { pattern: "/proofs", path: "/proofs" },
  { pattern: "/goals", path: "/goals" },
  { pattern: "/invoices", path: "/invoices" },
  { pattern: "/marketplace", path: "/marketplace" },
  { pattern: "/registry", path: "/registry" },
  { pattern: "/studio", path: "/studio" },
  { pattern: "/definitions", path: "/definitions" },
  { pattern: "/field-mapping", path: "/field-mapping" },
  { pattern: "/programmes", path: "/programmes" },
  { pattern: "/programmes/:programmeId", path: "/programmes/prog-platform" },
  { pattern: "/projects", path: "/projects" },
  { pattern: "/projects/:projectId", path: "/projects/proj-001" },
  { pattern: "/projects/:projectId/gantt", path: "/projects/proj-001/gantt" },
  { pattern: "/projects/:projectId/risks", path: "/projects/proj-001/risks" },
  { pattern: "/projects/:projectId/raci", path: "/projects/proj-001/raci" },
  { pattern: "/projects/:projectId/stakeholders", path: "/projects/proj-001/stakeholders" },
  { pattern: "/budgets", path: "/budgets" },
  { pattern: "/resource-planning", path: "/resource-planning" },
  { pattern: "/reports", path: "/reports" },
  { pattern: "/resources", path: "/resources" },
  { pattern: "/explore", path: "/explore" },
  { pattern: "/goals", path: "/goals" },
  { pattern: "/invoices", path: "/invoices" },
  { pattern: "/marketplace", path: "/marketplace" },
  { pattern: "/registry", path: "/registry" },
  { pattern: "/studio", path: "/studio" },
  { pattern: "/definitions", path: "/definitions" },
  { pattern: "/field-mapping", path: "/field-mapping" },
  { pattern: "/portal", path: "/portal" },
  { pattern: "/settings", path: "/settings" },
  { pattern: "/configurator", path: "/configurator" },
  { pattern: "/setup", path: "/setup" },
  { pattern: "/login", path: "/login", needsAuth: false, isLogin: true },
];
