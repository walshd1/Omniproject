import { create } from "zustand";
import { setResponseObserver } from "@workspace/api-client-react";

/**
 * Client-side read-availability signal — the sibling of `lib/data-quality.ts`. That one reports data
 * that arrived MALFORMED; this reports data that did not arrive at all, from the gateway's
 * `X-OmniProject-Sources-Unavailable` header (see docs/DEGRADED-READS.md).
 *
 * It matters because OmniProject holds no copy of anything: when a backend stops answering there is no
 * cache to fall back on, so a portfolio quietly renders with fewer numbers in it. The gateway already
 * refuses to publish a total summed over a subset — this is the half that tells the human WHY a figure
 * went missing, instead of leaving them to wonder whether the budget really is blank.
 *
 * DELIBERATELY NOT STICKY, unlike the data-quality store. Dirty data is a persistent property of a
 * backend, so `everRepaired` latches for the session. An outage is transient: a backend that has come
 * back is fine now, and a badge still claiming it is down would be worse than no badge — the operator
 * learns to ignore it. Each response therefore replaces the signal, and a clean response clears it.
 */
const HEADER = "X-OmniProject-Sources-Unavailable";

interface SourceAvailabilityState {
  /** Sources that did not answer on the most recent response that carried the header. 0 = all good. */
  unavailable: number;
  /** When that was, so a stale signal can be reasoned about. Null when nothing is outstanding. */
  at: number | null;
  note: (count: number, now?: number) => void;
}

export const useSourceAvailability = create<SourceAvailabilityState>((set) => ({
  unavailable: 0,
  at: null,
  note: (count, now = Date.now()) =>
    set(count > 0 ? { unavailable: count, at: now } : { unavailable: 0, at: null }),
}));

let installed = false;
/** Register the response observer once so every API response updates the signal. */
export function installSourceAvailabilityObserver(): void {
  if (installed) return;
  installed = true;
  setResponseObserver(({ headers }) => {
    const raw = headers.get(HEADER);
    // Absent header ⇒ every source answered ⇒ clear. That is what makes this self-healing: we do not
    // need a separate "recovered" event, the next good response is the recovery.
    const n = raw ? Number(raw) : 0;
    useSourceAvailability.getState().note(Number.isFinite(n) && n > 0 ? n : 0);
  });
}

/** The availability block the gateway puts on a degraded response body (portfolio summary/financials). */
export interface AvailabilityReport {
  complete: boolean;
  attempted: number;
  answered: number;
  unavailable: Array<{ source: string; reason: string }>;
}

/** "3 of 4 sources reporting" — the phrase the UI should lead with, or null when everything answered. */
export function describeAvailability(a: AvailabilityReport | undefined): string | null {
  if (!a || a.complete) return null;
  if (a.attempted > 0) return `${a.answered} of ${a.attempted} sources reporting`;
  return "some sources did not answer";
}

/**
 * Turn the gateway's raw source keys into something a reader can act on.
 *
 * The wire carries `project:p-8842` / `financials read failed` — exactly right for a log line or a
 * support ticket, and close to meaningless on screen: a reader cannot place that id, and a wall of
 * them buries the one fact that matters (some cost data is missing). So the notice shows the plain
 * sentence and keeps the raw keys in the tooltip, while the SERVER logs carry them properly.
 *
 * Grouped by kind and counted, so twenty failed projects read as one sentence rather than twenty lines.
 */
export function humaniseUnavailable(unavailable: ReadonlyArray<{ source: string; reason: string }>): string[] {
  const projects = unavailable.filter((u) => u.source.startsWith("project:")).length;
  const peers = unavailable.filter((u) => u.source.startsWith("peer:")).length;
  const out: string[] = [];
  if (projects > 0) {
    out.push(projects === 1 ? "One project's data didn't load." : `${projects} projects' data didn't load.`);
  }
  if (peers > 0) {
    out.push(peers === 1 ? "One connected region didn't answer." : `${peers} connected regions didn't answer.`);
  }
  for (const u of unavailable) {
    if (u.source === "projects") out.push("The project list didn't load, so this may not be your whole portfolio.");
    else if (u.source === "capacity") out.push("Resource capacity didn't load.");
    else if (u.source === "finance") out.push("Cost data didn't load.");
    else if (!u.source.startsWith("project:") && !u.source.startsWith("peer:")) out.push(`${u.source} didn't answer.`);
  }
  return out.length ? out : ["A source didn't answer."];
}

/** The raw keys, for the tooltip and for anyone reading the DOM — kept, just not shown as the headline. */
export function rawUnavailable(unavailable: ReadonlyArray<{ source: string; reason: string }>): string {
  return unavailable.map((u) => `${u.source} — ${u.reason}`).join("\n");
}

/** Human-readable age for a cached roll-up's `staleMs`, or null when the figure is live. */
export function describeStaleness(staleMs: number | undefined): string | null {
  if (staleMs === undefined || staleMs < 0) return null;
  const s = Math.round(staleMs / 1000);
  if (s < 1) return "cached moments ago";
  if (s < 60) return `cached ${s}s ago`;
  return `cached ${Math.round(s / 60)}m ago`;
}
