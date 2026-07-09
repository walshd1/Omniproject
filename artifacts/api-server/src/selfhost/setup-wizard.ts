/**
 * Self-host DB *setup wizard* — the pure state machine behind the wizard step that lets a first-time
 * operator (who has no existing PM tool) adopt OmniProject's own database, and behind the admin
 * screen that later tunes it. It is deliberately headless: `initialWizardState` + `wizardReducer`
 * drive the UI, `guardrails`/`canComplete` decide whether the step may finish, and `toConfig`
 * projects the state into the org-scope selection the capability-gating model consumes.
 *
 * The posture is **disclose, don't insure**. Adopting the self-host DB moves the ONLY copy of some
 * data into infrastructure OmniProject neither operates nor backs up nor warrants. So the wizard's
 * one hard gate is a data-responsibility acknowledgement: you cannot complete any non-off adoption
 * until you've explicitly accepted that the data is yours to secure, back up and own. Everything
 * else is a *warning* that informs the choice without blocking it — the operator stays in control.
 */
import type { SelfHostDomainId } from "./domains";
import { SELF_HOST_DOMAINS } from "./domains";
import type { GatingInput, SelfHostMode, SelfHostScopeSelection } from "./capability-gating";

/** The core (always-adopted) domain ids — the work-item spine, never a toggle. */
const CORE_DOMAIN_IDS: ReadonlySet<SelfHostDomainId> = new Set(
  SELF_HOST_DOMAINS.filter((d) => d.core).map((d) => d.id),
);

/** The gated (opt-in) domain ids — the ones the wizard offers as checkboxes. */
export const ADOPTABLE_DOMAIN_IDS: readonly SelfHostDomainId[] = SELF_HOST_DOMAINS
  .filter((d) => !d.core)
  .map((d) => d.id);

/** The wizard's state: the mode, the extra domains opted into, and the responsibility ack. */
export interface WizardState {
  mode: SelfHostMode;
  /** Extra (gated) domains opted in — core domains are always adopted and never listed here. */
  adopted: SelfHostDomainId[];
  /** The operator accepted that self-host data is theirs to own, secure, back up (disclose-not-insure). */
  acknowledgedDataResponsibility: boolean;
}

export type WizardAction =
  | { type: "setMode"; mode: SelfHostMode }
  | { type: "toggleDomain"; id: SelfHostDomainId }
  | { type: "acknowledgeDataResponsibility"; value: boolean }
  | { type: "reset" };

/** The starting state: off, nothing adopted, nothing acknowledged. */
export const initialWizardState: WizardState = {
  mode: "off",
  adopted: [],
  acknowledgedDataResponsibility: false,
};

/** Pure reducer. Setting the mode back to `off` clears the ack (there's nothing left to acknowledge). */
export function wizardReducer(state: WizardState, action: WizardState | WizardAction): WizardState {
  // Support both a full-state replace (handy for the React screen) and an action.
  if (!("type" in action)) return normalise(action);
  switch (action.type) {
    case "setMode": {
      const mode = action.mode;
      return normalise({
        ...state,
        mode,
        acknowledgedDataResponsibility: mode === "off" ? false : state.acknowledgedDataResponsibility,
      });
    }
    case "toggleDomain": {
      if (CORE_DOMAIN_IDS.has(action.id)) return state; // core is not a toggle
      const has = state.adopted.includes(action.id);
      const adopted = has ? state.adopted.filter((d) => d !== action.id) : [...state.adopted, action.id];
      return normalise({ ...state, adopted });
    }
    case "acknowledgeDataResponsibility":
      return { ...state, acknowledgedDataResponsibility: action.value };
    case "reset":
      return initialWizardState;
  }
}

/** Keep the state well-formed: dedupe adopted ids, drop any core/unknown ids that slipped in. */
function normalise(state: WizardState): WizardState {
  const adoptable = new Set<SelfHostDomainId>(ADOPTABLE_DOMAIN_IDS);
  const adopted = [...new Set(state.adopted)].filter((id) => adoptable.has(id));
  return { ...state, adopted };
}

/** A single guardrail verdict. `block` stops completion; `warn` informs but never blocks. */
export interface Guardrail {
  id: "data-responsibility" | "prefer-existing-tool" | "augmenting-fills-gaps-only" | "system-of-record-authority";
  level: "block" | "warn";
  active: boolean;
  message: string;
}

/**
 * The four guardrails, evaluated against a state. Exactly one is a BLOCK (the data-responsibility
 * ack); the other three are warnings that steer the choice — prefer connecting an existing tool,
 * understand that augmenting only fills gaps, understand that system-of-record makes your DB the
 * authoritative source. All four are returned every time (with `active`) so the UI can render the
 * inactive ones greyed rather than have them pop in and out.
 */
export function guardrails(state: WizardState): Guardrail[] {
  const adopting = state.mode !== "off";
  return [
    {
      id: "data-responsibility",
      level: "block",
      active: adopting && !state.acknowledgedDataResponsibility,
      message:
        "Data held in your database is yours to own, secure and back up. OmniProject does not operate, " +
        "back up, or warrant it. You must acknowledge this before enabling self-host storage.",
    },
    {
      id: "prefer-existing-tool",
      level: "warn",
      active: adopting,
      message:
        "Self-hosting our database is the non-preferred deployment. OmniProject is a stateless overlay — " +
        "prefer connecting an existing tool (Jira, OpenProject, a spreadsheet) so it stays your source of truth.",
    },
    {
      id: "augmenting-fills-gaps-only",
      level: "warn",
      active: state.mode === "augmenting",
      message:
        "In augmenting mode your database only owns fields no connected backend can hold. Fields a backend " +
        "already stores stay with that backend — the self-host copy of them would be ignored.",
    },
    {
      id: "system-of-record-authority",
      level: "warn",
      active: state.mode === "system-of-record",
      message:
        "In system-of-record mode your database becomes the authoritative source for the adopted domains, and " +
        "holds the only copy of that data. The OpenProject-compatible export view is your exit path.",
    },
  ];
}

/** The active blocking guardrails — non-empty ⇒ the wizard step cannot complete. */
export function blockers(state: WizardState): Guardrail[] {
  return guardrails(state).filter((g) => g.active && g.level === "block");
}

/** True when the wizard step may finish: `off` always completes; any adoption needs the ack. */
export function canComplete(state: WizardState): boolean {
  return blockers(state).length === 0;
}

/**
 * Does the self-host DB hold the ONLY copy of some data under this state? True for any non-off
 * adoption: system-of-record holds the sole copy of the whole adopted spine; augmenting holds the
 * sole copy of the gap fields no backend covers. This is the fact the data-responsibility ack is
 * about, so the wizard/admin can render the "in your database — your responsibility" disclosure.
 */
export function holdsOnlyCopy(state: Pick<WizardState, "mode">): boolean {
  return state.mode !== "off";
}

/** The config this wizard produces — the org-scope adoption, POSTed to /api/setup. */
export interface SelfHostConfig {
  mode: SelfHostMode;
  /** The gated domains opted into at org level (core domains are implicit). */
  adopted: SelfHostDomainId[];
  acknowledgedDataResponsibility: boolean;
}

/**
 * Project the wizard state into its persisted config. Throws if the state can't complete, so a caller
 * can never persist an un-acknowledged adoption — the ack is enforced here, not just in the UI.
 */
export function toConfig(state: WizardState): SelfHostConfig {
  if (!canComplete(state)) {
    throw new Error("cannot complete self-host setup: " + blockers(state).map((b) => b.id).join(", "));
  }
  const norm = normalise(state);
  return {
    mode: norm.mode,
    adopted: [...norm.adopted],
    acknowledgedDataResponsibility: norm.acknowledgedDataResponsibility,
  };
}

/** Project a persisted config into the org-scope selection the capability-gating model consumes. */
export function configToOrgSelection(config: SelfHostConfig): SelfHostScopeSelection {
  return { adopted: config.adopted };
}

/** Build a full `GatingInput` (org scope only) straight from a wizard config — the common case. */
export function configToGatingInput(config: SelfHostConfig): GatingInput {
  return { mode: config.mode, org: configToOrgSelection(config) };
}
