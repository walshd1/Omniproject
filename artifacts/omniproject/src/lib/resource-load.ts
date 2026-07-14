/**
 * What-if resource load — pure, so it's unit-tested without the DOM.
 *
 * The schedule sandbox lets you drag work into the future; this answers the
 * resource question that comes with it: *does moving this work pile someone up?*
 * The signal is concurrency — how many of a person's active tasks overlap in
 * time. Dragging a task to overlap another of the same assignee's tasks raises
 * their peak concurrency; that's a capacity clash you can see and react to,
 * entirely from dates + assignee (no effort/capacity numbers required, so it
 * works wherever a backend surfaces an assignee).
 */

export interface LoadInput {
  id: string;
  title: string;
  assignee: string | null;
  /** Resolved (post-shift) inclusive day range. */
  startDay: number;
  endDay: number;
  /** Not done/cancelled — only live work consumes capacity. */
  active: boolean;
}

export interface PersonLoad {
  assignee: string;
  taskCount: number;
  /** Most tasks active on any single day. */
  peakConcurrency: number;
  /** peakConcurrency ≥ 2 — at least two tasks overlap. */
  contended: boolean;
  /** A representative peak: the overlapping task ids/titles, for the UI. */
  peak: { day: number; tasks: { id: string; title: string }[] } | null;
}

function peakFor(items: LoadInput[]): { count: number; day: number; tasks: { id: string; title: string }[] } {
  const best = { count: 0, day: 0, tasks: [] as { id: string; title: string }[] };
  if (items.length === 0) return best;

  // Sweep line: +1 at a task's start day, -1 the day AFTER its end (endpoints
  // inclusive, matching the old `startDay <= day && endDay >= day`). Processing
  // all deltas at a position together yields the concurrency for that day; peak
  // concurrency only rises at a start, so the peak is always on some task's start
  // day — the same candidate set the old O(n²) probe loop tested.
  const delta = new Map<number, number>();
  for (const x of items) {
    delta.set(x.startDay, (delta.get(x.startDay) ?? 0) + 1);
    delta.set(x.endDay + 1, (delta.get(x.endDay + 1) ?? 0) - 1);
  }
  const positions = [...delta.keys()].sort((a, b) => a - b);
  const countAtDay = new Map<number, number>();
  let running = 0;
  for (const pos of positions) {
    running += delta.get(pos)!;
    countAtDay.set(pos, running);
  }

  // First start day (in items order) attaining the max concurrency — exactly
  // matches the previous strict-'>' update over probes in the same order.
  let bestCount = 0;
  let bestDay = 0;
  for (const probe of items) {
    const c = countAtDay.get(probe.startDay) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      bestDay = probe.startDay;
    }
  }
  best.count = bestCount;
  best.day = bestDay;
  best.tasks = items
    .filter((x) => x.startDay <= bestDay && x.endDay >= bestDay)
    .map((x) => ({ id: x.id, title: x.title }));
  return best;
}

/** Per-assignee load for one schedule (base or resolved). */
export function resourceLoad(items: LoadInput[]): PersonLoad[] {
  const byPerson = new Map<string, LoadInput[]>();
  for (const it of items) {
    if (!it.active || !it.assignee) continue;
    const list = byPerson.get(it.assignee) ?? [];
    list.push(it);
    byPerson.set(it.assignee, list);
  }
  const out: PersonLoad[] = [];
  for (const [assignee, list] of byPerson) {
    const p = peakFor(list);
    out.push({
      assignee,
      taskCount: list.length,
      peakConcurrency: p.count,
      contended: p.count >= 2,
      peak: p.count >= 2 ? { day: p.day, tasks: p.tasks } : null,
    });
  }
  return out.sort((a, b) => b.peakConcurrency - a.peakConcurrency || a.assignee.localeCompare(b.assignee));
}

export interface LoadDelta extends PersonLoad {
  /** Peak concurrency before any shift, for the same person. */
  basePeak: number;
  /** The scenario raised this person's peak concurrency (a new clash). */
  newlyContended: boolean;
}

/**
 * Compare a scenario's load to the base (un-shifted) load, flagging people the
 * what-if has *newly* piled up. Only contended people are returned.
 */
export function loadDeltas(base: LoadInput[], scenario: LoadInput[]): LoadDelta[] {
  const basePeak = new Map(resourceLoad(base).map((p) => [p.assignee, p.peakConcurrency]));
  return resourceLoad(scenario)
    .filter((p) => p.contended)
    .map((p) => {
      const bp = basePeak.get(p.assignee) ?? 0;
      return { ...p, basePeak: bp, newlyContended: p.peakConcurrency > bp };
    });
}
