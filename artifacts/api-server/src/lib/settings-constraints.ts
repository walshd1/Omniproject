import type { SettingsState } from "./settings";

/**
 * Settings incompatibility registry — the ONE place cross-field settings constraints are declared, so
 * illegal COMBINATIONS are prevented rather than merely caught late. It drives two consumers from a
 * single source of truth:
 *   - the server (`validatePatch`) rejects a patch whose effective result violates a rule; and
 *   - the admin UI reads the `locks` (via the settings read) and DISABLES / FORCES the incompatible
 *     controls, so an operator can't even pick the illegal combination (poka-yoke, not error message).
 *
 * A rule that expresses a hard contradiction emits a `violation` (server 400 + UI). A rule that just
 * makes a field INERT (e.g. an as-of date under the live-spot policy) emits a `lock` only — harmless if
 * left set, but the UI greys it out. Pure + side-effect-free, so the whole map is unit-testable.
 */

export type LockState = "disabled" | "forced";

export interface FieldLock {
  /** Dotted settings path the UI should lock (e.g. "fxRateAsOfDate", "loggingSync.enabled"). */
  path: string;
  state: LockState;
  /** For `state:"forced"` — the value the field is pinned to. */
  forcedValue?: unknown;
  /** Human reason naming the DRIVING setting, for the UI tooltip. */
  reason: string;
}

export interface ConstraintViolation {
  path: string;
  message: string;
}

export interface ConstraintResult {
  locks: FieldLock[];
  violations: ConstraintViolation[];
}

/** One incompatibility rule. Each does ONE job: inspect the effective settings and emit the lock(s) it
 *  implies and/or the violation if the combination is illegal. Pure. */
type ConstraintRule = (s: SettingsState) => { locks?: FieldLock[]; violation?: ConstraintViolation };

const RULES: ConstraintRule[] = [
  // ── Financial: FX rate policy / as-of date only mean anything with a reporting currency ──────────
  // No reporting currency ⇒ there is no conversion, so the FX policy + as-of date are inert.
  (s) => s.reportingCurrency
    ? {}
    : {
        locks: [
          { path: "fxRatePolicy", state: "disabled", reason: "No reporting currency is set, so FX conversion is off." },
          { path: "fxRateAsOfDate", state: "disabled", reason: "No reporting currency is set, so FX conversion is off." },
        ],
      },
  // The live "spot" policy uses current rates, so the as-of date does not apply (portfolio-summary only
  // passes an as-of date for non-spot policies).
  (s) =>
    s.reportingCurrency && s.fxRatePolicy === "spot"
      ? { locks: [{ path: "fxRateAsOfDate", state: "disabled", reason: "The spot FX policy uses live rates — an as-of date does not apply." }] }
      : {},

  // ── AI: a model is only meaningful once a provider is chosen ──────────────────────────────────────
  (s) =>
    s.aiProvider === "none"
      ? { locks: [{ path: "aiModel", state: "forced", forcedValue: null, reason: "No AI provider is selected, so a model can't be chosen." }] }
      : {},

  // ── Governance: a feature can't be org-ENABLED and org-DISABLED at once ───────────────────────────
  // (a real contradiction — disable would silently win, dropping the enable). Hard violation.
  (s) => {
    const disabled = new Set(s.disabledFeatures);
    const clash = s.enabledFeatures.find((f) => disabled.has(f));
    return clash
      ? { violation: { path: "enabledFeatures", message: `feature "${clash}" can't be both enabled and disabled` } }
      : {};
  },

  // (Egress log-sync left SettingsState for the `logging-sync` config def — its "url + warranty ack before
  //  enable" gate is enforced by the route validator + the panel's own local guard. Roadmap Phase C.)

  // ── Self-host storage: can only be enabled with the data-responsibility acknowledgement ───────────
  (s) =>
    !s.selfHost.acknowledgedDataResponsibility
      ? { locks: [{ path: "selfHost.mode", state: "disabled", reason: "Acknowledge the self-host data-responsibility notice before enabling a storage mode." }] }
      : {},
];

/** Evaluate every incompatibility rule against the effective settings, aggregating the locks + any
 *  violations. Order-stable so the first violation is deterministic for the 400 message. */
export function evaluateConstraints(s: SettingsState): ConstraintResult {
  const locks: FieldLock[] = [];
  const violations: ConstraintViolation[] = [];
  for (const rule of RULES) {
    const r = rule(s);
    if (r.locks) locks.push(...r.locks);
    if (r.violation) violations.push(r.violation);
  }
  return { locks, violations };
}
