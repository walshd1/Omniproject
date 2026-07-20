import {
  type WorkingCalendar,
  addWorkingDays,
  nextWorkingDay,
  workingFinish,
} from "./working-calendar";

/**
 * Scheduling CONSTRAINTS + typed DEPENDENCIES (roadmap 3.1 slice 2) — the pure, calendar-aware primitives a
 * forward-pass auto-scheduler applies to ONE task / ONE edge at a time. Built on `working-calendar` so every
 * offset skips non-working time. Like the rest of the scheduling stack this is pure and projected: it maps
 * inputs → an earliest working-day start (or a violation flag), never persists, never a source of truth.
 *
 * Semantics (all day indices are the shared DAY_MS bucketing; a "finish" is the LAST working day a task
 * occupies, inclusive, matching `workingFinish`):
 *   • Dependency kinds — FS finish→start, SS start→start, FF finish→finish, SF start→finish — each with a
 *     `lagWorkingDays` that may be negative (a lead).
 *   • Constraint kinds — the forward-driving ones (SNET/FNET/MSO/MFO) move a task's start later/fix it;
 *     the "no later than" ones (SNLT/FNLT) don't pull a forward pass earlier, they're deadlines whose
 *     breach is reported by {@link constraintViolation}. ASAP is the unconstrained default.
 */

/** A precedence relationship kind (MS-Project style). FS is the default. */
export type DependencyKind = "FS" | "SS" | "FF" | "SF";

/** A typed precedence edge with a working-day lag (negative = lead). */
export interface TypedDependency {
  predecessorId: string;
  successorId: string;
  kind: DependencyKind;
  lagWorkingDays: number;
}

/** A predecessor's resolved placement, as the dependency math needs it. */
export interface Placement {
  startDay: number;
  /** Last working day occupied (inclusive) = `workingFinish(cal, startDay, duration)`. */
  finishDay: number;
}

/** Task date constraints. ASAP = none; the rest carry a `day` (the constraint date, a day index). */
export type ConstraintKind = "ASAP" | "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO";

export interface TaskConstraint {
  kind: ConstraintKind;
  /** The constraint's day index; required for every kind except ASAP (ignored there). */
  day?: number;
}

/** Normalise a dependency kind/lag from loose input (defaults FS, lag 0). */
export function normaliseDependencyKind(kind: unknown): DependencyKind {
  return kind === "SS" || kind === "FF" || kind === "SF" ? kind : "FS";
}

/**
 * The start day (snapped to a working day) whose task of `duration` working days FINISHES on `finishDay`.
 * The inverse of `workingFinish`; a 0/1-day task starts where it finishes.
 */
export function startFromFinish(cal: WorkingCalendar, finishDay: number, durationWorkingDays: number): number {
  const span = Math.max(durationWorkingDays, 1) - 1;
  return addWorkingDays(cal, finishDay, -span);
}

/**
 * The earliest working-day start the successor may take to satisfy ONE typed dependency on a placed
 * predecessor. FF/SF derive the start from a required finish, so they need the successor's duration.
 */
export function earliestStartFromDependency(
  cal: WorkingCalendar,
  dep: Pick<TypedDependency, "kind" | "lagWorkingDays">,
  pred: Placement,
  succDurationWorkingDays: number,
): number {
  const lag = dep.lagWorkingDays;
  switch (dep.kind) {
    case "SS":
      return addWorkingDays(cal, pred.startDay, lag);
    case "FF":
      return startFromFinish(cal, addWorkingDays(cal, pred.finishDay, lag), succDurationWorkingDays);
    case "SF":
      return startFromFinish(cal, addWorkingDays(cal, pred.startDay, lag), succDurationWorkingDays);
    case "FS":
    default:
      // The working day after the predecessor finishes, plus lag.
      return addWorkingDays(cal, pred.finishDay, lag + 1);
  }
}

/**
 * Apply a task constraint to a proposed (dependency-driven) start in a FORWARD pass. Returns the adjusted
 * working-day start. SNET/FNET push later if needed; MSO/MFO fix the start; SNLT/FNLT/ASAP leave the forward
 * start untouched (SNLT/FNLT are deadlines — see {@link constraintViolation}). `duration` lets FNET/MFO map a
 * finish requirement back to a start.
 */
export function applyConstraint(
  cal: WorkingCalendar,
  constraint: TaskConstraint | undefined,
  proposedStartDay: number,
  durationWorkingDays: number,
): number {
  const snapped = nextWorkingDay(cal, proposedStartDay);
  if (!constraint || constraint.kind === "ASAP" || constraint.day === undefined) return snapped;
  const day = constraint.day;
  switch (constraint.kind) {
    case "SNET": // start no earlier than
      return Math.max(snapped, nextWorkingDay(cal, day));
    case "FNET": // finish no earlier than → start no earlier than the start that finishes on `day`
      return Math.max(snapped, startFromFinish(cal, nextWorkingDay(cal, day), durationWorkingDays));
    case "MSO": // must start on
      return nextWorkingDay(cal, day);
    case "MFO": // must finish on
      return startFromFinish(cal, nextWorkingDay(cal, day), durationWorkingDays);
    case "SNLT": // start / finish no later than — deadlines; don't pull a forward pass earlier
    case "FNLT":
    default:
      return snapped;
  }
}

/**
 * Whether a resolved placement breaches its constraint. The "no later than" and "must" kinds can be
 * violated by a forward pass (a predecessor pushed the task past its deadline / off its fixed date); the
 * "no earlier" kinds are already enforced by {@link applyConstraint} so never report here.
 */
export function constraintViolation(constraint: TaskConstraint | undefined, placement: Placement): boolean {
  if (!constraint || constraint.kind === "ASAP" || constraint.day === undefined) return false;
  const { startDay, finishDay } = placement;
  const day = constraint.day;
  switch (constraint.kind) {
    case "SNLT":
      return startDay > day;
    case "FNLT":
      return finishDay > day;
    case "MSO":
      return startDay !== day;
    case "MFO":
      return finishDay !== day;
    default:
      return false;
  }
}

/** Convenience: a task's placement from a start + working-day duration. */
export function placementOf(cal: WorkingCalendar, startDay: number, durationWorkingDays: number): Placement {
  const start = nextWorkingDay(cal, startDay);
  return { startDay: start, finishDay: workingFinish(cal, start, durationWorkingDays) };
}
