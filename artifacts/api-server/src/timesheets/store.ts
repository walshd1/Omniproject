/**
 * Timesheet STORE seam — where timesheets live is BELOW the seam (the operator's choice, per
 * docs/PPM-DEPTH.md): the self-host DB when adoption is on, and/or a 3rd-party backend when it
 * supports timesheets and it's enabled. The gateway holds nothing: it resolves the right store and
 * delegates. A provider is registered at boot (self-host / broker-backed, deferred like the retention
 * source); when none is available the API answers an honest "not enabled" instead of inventing a home.
 */
import { getSettings } from "../lib/settings";
import type { Timesheet } from "./state-machine";

/** Which below-seam store a timesheet was routed to. */
export type TimesheetSource = "self-host" | "backend";

/** The persistence contract. Every method is async — the real one talks to the self-host DB / broker. */
export interface TimesheetStore {
  source: TimesheetSource;
  /** Sheets for a resource (or all, for an approver's queue), optionally filtered by status. */
  list(filter: { resourceId?: string; status?: Timesheet["status"] }): Promise<Timesheet[]>;
  get(id: string): Promise<Timesheet | null>;
  /** Upsert a sheet (idempotent on id). */
  save(sheet: Timesheet): Promise<void>;
}

export interface TimesheetScope {
  programmeId?: string | null;
  projectId?: string | null;
}

/** Resolve the store for a scope, or null when timesheets aren't enabled anywhere. */
export type TimesheetStoreProvider = (scope: TimesheetScope) => TimesheetStore | null;

let provider: TimesheetStoreProvider = () => null;

/** Register the deployment's timesheet store provider (self-host / broker), at boot. */
export function registerTimesheetStore(p: TimesheetStoreProvider): void {
  provider = p;
}

/** Reset to no store — used by tests to isolate. */
export function resetTimesheetStore(): void {
  provider = () => null;
}

/** The store for a scope, or null. */
export function timesheetStoreFor(scope: TimesheetScope = {}): TimesheetStore | null {
  return provider(scope);
}

/**
 * Report which timesheet sources a deployment COULD use, for the UI to explain availability:
 *  - self-host: adoption is on (settings.selfHost.mode !== "off");
 *  - backend: a backend-source provider is registered.
 * `available` is true when a store actually resolves for the (org) scope.
 */
export function describeTimesheetSources(scope: TimesheetScope = {}): {
  available: boolean;
  source: TimesheetSource | null;
  selfHostAdopted: boolean;
} {
  const selfHostAdopted = getSettings().selfHost.mode !== "off";
  const store = timesheetStoreFor(scope);
  return { available: !!store, source: store?.source ?? null, selfHostAdopted };
}
