import { isPmoOrAdmin, type Role } from "./auth";

/**
 * FIRST-RUN front door. A brand-new instance is UNCONFIGURED (no backend connected). The first qualifying
 * admin who lands on the home route is sent into the setup wizard (the preset-driven Configurator) so setup
 * isn't something they have to go hunting for. It's escapable: a "skip for now" dismiss is remembered per
 * browser, and once a backend is connected (or the instance is otherwise configured) the gate never fires
 * again. Pure predicate + a tiny localStorage flag, so the gate logic is unit-tested without a router.
 */

const DISMISS_KEY = "omni.firstRunDismissed";

/** Whether the current browser has dismissed the first-run redirect. */
export function firstRunDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

/** Remember that the operator chose to skip first-run setup (so we stop redirecting them). */
export function dismissFirstRun(): void {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage disabled — the gate just re-fires */ }
}

/** The route segment that counts as "the landing page" (redirect only from here, never mid-app). */
function isLandingSegment(segment: string): boolean {
  return segment === "" || segment === "home";
}

/**
 * Should this session be redirected into the setup wizard right now? True only when: the caller is an
 * admin/PMO (a lower role can't act on the wizard anyway), the instance is UNCONFIGURED, first-run hasn't been
 * dismissed on this browser, and they're on the landing page (so we never yank them out of a page mid-task).
 */
export function shouldGateToSetup(input: {
  role: Role | undefined;
  brokerConfigured: boolean;
  dismissed: boolean;
  segment: string;
  /** A DEMO instance is pre-seeded sample data being explored, not a blank deployment awaiting setup —
   *  so the first-run wizard must never hijack its landing page. Only real (oidc) instances gate. */
  demoMode?: boolean;
}): boolean {
  if (input.demoMode) return false;
  if (!isPmoOrAdmin(input.role)) return false;
  if (input.brokerConfigured) return false;
  if (input.dismissed) return false;
  return isLandingSegment(input.segment);
}
