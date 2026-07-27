/**
 * DUPLICATE-DEMAND DETECTION — surface intake/demand items that are probably the SAME request worded
 * differently (roadmap §4.4, "duplicate-demand detection"), so a PMO isn't triaging the same need three times.
 *
 * This is CONTENT similarity, deliberately distinct from entity-resolution.ts: that module reconciles the same
 * real-world ENTITY across backends by a normalised identity key (email/name equality); this one scores the
 * textual OVERLAP between two demand descriptions with a Jaccard token metric, so "Add SSO login" and "Support
 * single sign-on for login" surface as candidates even though no field is equal. Candidates only — never
 * auto-merged, same posture as entity-resolution's fuzzy matcher.
 *
 * Each item's text (+ optional tags) is tokenised to a set; the Jaccard similarity |A∩B| / |A∪B| of each pair is
 * ranked, pairs at/above a threshold are returned, and transitive duplicates are grouped into clusters via
 * union-find (so "A≈B, B≈C" reports one {A,B,C}). Pure, no I/O; deterministic (pairs ranked by similarity then
 * id, clusters sorted; no Math.random). Validation first: text coerced with String(), tokens lowercased +
 * length-filtered. Every divide guarded — an empty token union yields similarity 0, never NaN. Comparison is
 * O(n²) in the item count (standard for pairwise dedup); nothing is silently dropped.
 */

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface DemandItem {
  id: string;
  /** Free text (title + description, however the caller wants to combine it). */
  text?: string;
  /** Optional tags/labels; folded into the token set lowercased. */
  tags?: string[];
}

export interface DedupOptions {
  /** Minimum Jaccard similarity for a pair to be reported. Default 0.5. Coerced + clamped to [0, 1]. */
  threshold?: number;
  /** Tokens shorter than this are dropped (noise). Default 2. */
  minTokenLength?: number;
}

export interface DuplicatePair {
  /** The two item ids, ordered aId < bId for a stable, direction-free pair. */
  aId: string;
  bId: string;
  /** Jaccard similarity 0…1 (rounded to 4 dp). */
  similarity: number;
  /** The tokens both items share, sorted — the plain-English "why". */
  shared: string[];
}

export interface DedupResult {
  /** Candidate duplicate pairs at/above the threshold, most-similar first (id tiebreak). */
  pairs: DuplicatePair[];
  /** Transitive clusters of ≥ 2 ids linked by the reported pairs (each sorted; clusters sorted by first id). */
  clusters: string[][];
}

/** Tokenise text into a lowercased set, dropping tokens shorter than `minLen`. */
function tokenize(text: unknown, minLen: number): Set<string> {
  const out = new Set<string>();
  for (const t of String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= minLen) out.add(t);
  }
  return out;
}

/** Jaccard similarity of two token sets: |A∩B| / |A∪B|, guarded (empty union ⇒ 0). */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] };
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const shared: string[] = [];
  for (const t of small) if (large.has(t)) shared.push(t);
  const union = a.size + b.size - shared.length;
  return { score: union === 0 ? 0 : shared.length / union, shared: shared.sort(byStr) };
}

/** Union-find over the reported pairs, yielding sorted clusters of ≥ 2 ids. */
function cluster(ids: readonly string[], pairs: readonly DuplicatePair[]): string[][] {
  const parent = new Map<string, string>();
  ids.forEach((id) => parent.set(id, id));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x; // path-compress
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const p of pairs) {
    const ra = find(p.aId), rb = find(p.bId);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(id);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.sort(byStr))
    .sort((x, y) => byStr(x[0]!, y[0]!));
}

/**
 * Detect probable duplicate demand items by pairwise token-overlap similarity. Empty/singleton input ⇒ no
 * pairs, no clusters. Only ids that appear in a reported pair can appear in a cluster.
 */
export function detectDuplicateDemand(items: readonly DemandItem[], options: DedupOptions = {}): DedupResult {
  const threshold = Math.min(1, Math.max(0, Number.isFinite(options.threshold as number) ? (options.threshold as number) : 0.5));
  const minLen = Number.isFinite(options.minTokenLength as number) ? Math.max(1, options.minTokenLength as number) : 2;

  const tokens = items.map((it) => {
    const set = tokenize(it.text, minLen);
    if (Array.isArray(it.tags)) for (const tag of it.tags) { const t = String(tag).toLowerCase(); if (t) set.add(t); }
    return { id: String(it.id), set };
  });

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const a = tokens[i]!, b = tokens[j]!;
      const { score, shared } = jaccard(a.set, b.set);
      if (score >= threshold && score > 0) {
        const [aId, bId] = byStr(a.id, b.id) <= 0 ? [a.id, b.id] : [b.id, a.id];
        pairs.push({ aId, bId, similarity: round4(score), shared });
      }
    }
  }
  pairs.sort((x, y) => (y.similarity !== x.similarity ? y.similarity - x.similarity : byStr(x.aId, y.aId) || byStr(x.bId, y.bId)));

  return { pairs, clusters: cluster(tokens.map((t) => t.id), pairs) };
}
