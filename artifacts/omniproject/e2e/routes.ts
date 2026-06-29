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
  { pattern: "/dashboards", path: "/dashboards" },
  { pattern: "/programmes", path: "/programmes" },
  { pattern: "/programmes/:programmeId", path: "/programmes/prog-platform" },
  { pattern: "/projects", path: "/projects" },
  { pattern: "/projects/:projectId", path: "/projects/proj-001" },
  { pattern: "/reports", path: "/reports" },
  { pattern: "/resources", path: "/resources" },
  { pattern: "/explore", path: "/explore" },
  { pattern: "/settings", path: "/settings" },
  { pattern: "/setup", path: "/setup" },
  { pattern: "/login", path: "/login", needsAuth: false, isLogin: true },
];
