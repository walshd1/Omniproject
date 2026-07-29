/**
 * ACCESS-REVIEW / RECERTIFICATION ENGINE — the periodic "does this person still need this access?" campaign that
 * SOC 2 / ISO 27001 auditors expect and that the platform did not yet compute (IAM assessment gap S2). Given the
 * current grant assignments and when each was last reviewed, it classifies every grant against a review cadence,
 * builds a worst-first recertification worklist, batches it per reviewer, and tallies the campaign — so an admin
 * gets "7 privileged grants overdue, 3 never reviewed" instead of a spreadsheet.
 *
 * Pure, no I/O, and — like the rest of the catalogue — DETERMINISTIC: it never calls `Date`; `now` and every
 * timestamp are passed in as epoch-millisecond numbers, so a test (and a reproducible campaign run) is stable.
 * Validation first: timestamps coerced via numLoose, a missing `lastReviewedAt` ⇒ never-reviewed, ages clamped
 * ≥ 0; the ms→days divide is by a fixed constant (never user input), so nothing here can produce NaN/Infinity.
 * Privileged grants get a shorter default cadence than standard ones — the higher the blast radius, the sooner
 * it must be re-attested.
 */
import { numLoose } from "./num";

const MS_PER_DAY = 86_400_000;
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export type Sensitivity = "standard" | "privileged";
export type ReviewStatus = "current" | "due" | "overdue" | "never-reviewed";

export interface GrantAssignment {
  id: string;
  subjectId: string;
  /** The role / permission-set / capability the grant confers (display + grouping). */
  grantLabel: string;
  /** Higher blast radius ⇒ shorter cadence. Defaults to "standard". */
  sensitivity?: Sensitivity;
  /** When the grant was made (epoch ms). Used as the age baseline when never reviewed. */
  grantedAt: number;
  /** When the grant was last recertified (epoch ms); absent/null ⇒ never reviewed. */
  lastReviewedAt?: number | null;
  /** Who owns the recertification; absent ⇒ the "unassigned" batch. */
  reviewerId?: string;
}

export interface AccessReviewOptions {
  /** Current time as epoch ms — REQUIRED (the engine never calls Date). */
  now: number;
  /** Max days since last review before a grant is overdue, per sensitivity. Default { standard: 180, privileged: 90 }. */
  maxAgeDaysBySensitivity?: Partial<Record<Sensitivity, number>>;
  /** Fallback cadence when a sensitivity has no explicit entry. Default 180. */
  defaultMaxAgeDays?: number;
  /** A grant within this many days of its cadence is flagged "due" (approaching). Default 14. */
  dueWindowDays?: number;
}

export interface ReviewItem {
  id: string;
  subjectId: string;
  grantLabel: string;
  sensitivity: Sensitivity;
  reviewerId: string | null;
  status: ReviewStatus;
  /** Days since the last review (or since grant when never reviewed), clamped ≥ 0. */
  ageDays: number;
  /** The cadence applied (max age in days for this grant's sensitivity). */
  maxAgeDays: number;
  /** Days until due; negative-clamped to null once due/overdue/never. */
  dueInDays: number | null;
}

export interface ReviewerBatch {
  reviewerId: string;
  items: ReviewItem[];
}

export interface AccessReviewResult {
  /** Every assignment, classified (input order). */
  items: ReviewItem[];
  /** Grants needing action (overdue → never-reviewed → due), worst-first, id-tiebroken. */
  worklist: ReviewItem[];
  /** The worklist grouped by reviewer ("unassigned" collects grants with no reviewer), reviewer-id sorted. */
  byReviewer: ReviewerBatch[];
  counts: Record<ReviewStatus, number>;
}

const DEFAULT_CADENCE: Record<Sensitivity, number> = { standard: 180, privileged: 90 };
// Worst-first rank: overdue before never-reviewed before due (current never reaches the worklist).
const STATUS_RANK: Record<ReviewStatus, number> = { overdue: 0, "never-reviewed": 1, due: 2, current: 3 };

/**
 * Classify every grant against its review cadence and assemble the recertification campaign. Empty assignments ⇒
 * empty worklist and zero counts. `now` and all timestamps are epoch-ms numbers supplied by the caller.
 */
export function reviewAccess(assignments: readonly GrantAssignment[], options: AccessReviewOptions): AccessReviewResult {
  const now = numLoose(options.now);
  const cadence = { ...DEFAULT_CADENCE, ...(options.maxAgeDaysBySensitivity ?? {}) };
  const fallback = options.defaultMaxAgeDays === undefined ? 180 : Math.max(0, numLoose(options.defaultMaxAgeDays));
  const dueWindow = options.dueWindowDays === undefined ? 14 : Math.max(0, numLoose(options.dueWindowDays));

  const items: ReviewItem[] = assignments.map((a) => {
    const sensitivity: Sensitivity = a.sensitivity === "privileged" ? "privileged" : "standard";
    const maxAgeDays = Math.max(0, numLoose(cadence[sensitivity] ?? fallback));
    const reviewedAt = a.lastReviewedAt === undefined || a.lastReviewedAt === null ? null : numLoose(a.lastReviewedAt);
    const neverReviewed = reviewedAt === null;
    const baseline = neverReviewed ? numLoose(a.grantedAt) : reviewedAt;
    const ageDays = Math.max(0, (now - baseline) / MS_PER_DAY); // divide by a constant — never NaN/Infinity

    let status: ReviewStatus;
    let dueInDays: number | null;
    if (neverReviewed) {
      status = "never-reviewed";
      dueInDays = null;
    } else if (ageDays > maxAgeDays) {
      status = "overdue";
      dueInDays = null;
    } else if (ageDays >= maxAgeDays - dueWindow) {
      status = "due";
      dueInDays = Math.max(0, maxAgeDays - ageDays);
    } else {
      status = "current";
      dueInDays = maxAgeDays - ageDays;
    }

    return {
      id: String(a.id),
      subjectId: String(a.subjectId),
      grantLabel: String(a.grantLabel),
      sensitivity,
      reviewerId: a.reviewerId === undefined || a.reviewerId === null || a.reviewerId === "" ? null : String(a.reviewerId),
      status,
      ageDays: Math.round(ageDays * 100) / 100,
      maxAgeDays,
      dueInDays: dueInDays === null ? null : Math.round(dueInDays * 100) / 100,
    };
  });

  // Worklist: everything needing action, worst-first (status rank, then most-overdue = highest ageDays, then id).
  const worklist = items
    .filter((i) => i.status !== "current")
    .sort((a, b) =>
      STATUS_RANK[a.status] !== STATUS_RANK[b.status]
        ? STATUS_RANK[a.status] - STATUS_RANK[b.status]
        : b.ageDays !== a.ageDays
          ? b.ageDays - a.ageDays
          : byStr(a.id, b.id),
    );

  // Per-reviewer batches over the worklist ("unassigned" for grants with no reviewer), reviewer-id sorted.
  const batchMap = new Map<string, ReviewItem[]>();
  for (const item of worklist) {
    const key = item.reviewerId ?? "unassigned";
    (batchMap.get(key) ?? batchMap.set(key, []).get(key)!).push(item);
  }
  const byReviewer: ReviewerBatch[] = [...batchMap.entries()]
    .map(([reviewerId, batchItems]) => ({ reviewerId, items: batchItems }))
    .sort((a, b) => byStr(a.reviewerId, b.reviewerId));

  const counts: Record<ReviewStatus, number> = { current: 0, due: 0, overdue: 0, "never-reviewed": 0 };
  for (const i of items) counts[i.status]++;

  return { items, worklist, byReviewer, counts };
}
