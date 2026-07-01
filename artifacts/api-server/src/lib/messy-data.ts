import type { Row } from "../broker/types";

/**
 * Messy-data generator — synthetic real-world imperfection for DEV MODE.
 *
 * Real backends hand us dirty data: half-filled records, enum values in three
 * different casings, currencies as symbols, dates that make no sense, numbers that
 * arrived as strings, duplicate ids across systems, missing provenance. This module
 * is a PURE transform that injects those imperfections into read rows so we can SEE
 * how resilient our derivations, reports and screens are to them — before a customer's
 * real data finds the weak spot for us.
 *
 * It is pure (deterministic given a seed; no I/O, no env, no dev-mode import). The
 * dev-only gating and the broker wiring live in broker/messy-broker.ts; production
 * never reaches this because that gate is off. The `current` config below is the live,
 * runtime-toggleable state (seeded from env at boot) the dev-mode surface reads/writes.
 */

// ── Deterministic PRNG (seeded, so the same seed reproduces the same mess) ──────

/** FNV-1a hash of a string → a 32-bit seed. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny, fast, seedable PRNG. Returns a [0,1) generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const chance = (rng: Rng, p: number): boolean => rng() < p;
function pick<T>(rng: Rng, arr: readonly T[]): T | undefined {
  return arr.length ? arr[Math.floor(rng() * arr.length)] : undefined;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface MessyConfig {
  /** Master switch. Even when true, the broker only messifies IN DEV MODE. */
  on: boolean;
  /** Deterministic seed — the same seed reproduces the same imperfections. */
  seed: string;
  /** Overall imperfection rate, 0..1 (scales every gremlin's own base rate). */
  intensity: number;
  /** Active gremlin ids; empty ⇒ all of them. */
  gremlins: string[];
}

/** Parse the messy-data config from the environment (the boot default). */
export function messyDataConfigFromEnv(): MessyConfig {
  const on = /^(1|true|on|yes)$/i.test(process.env["OMNI_MESSY_DATA"]?.trim() ?? "");
  const intensityRaw = Number(process.env["OMNI_MESSY_INTENSITY"]);
  const intensity = Number.isFinite(intensityRaw) ? Math.min(1, Math.max(0, intensityRaw)) : 0.4;
  const gremlins = (process.env["OMNI_MESSY_GREMLINS"]?.trim() ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "all" && GREMLIN_IDS.has(s));
  return { on, seed: process.env["OMNI_MESSY_SEED"]?.trim() || "omni", intensity, gremlins };
}

// The live, runtime-toggleable config (seeded from env). Mutated only via the
// dev-mode surface; read by the broker decorator and the dev-mode watermark.
let current: MessyConfig = messyDataConfigFromEnv();

/** The current messy-data config. */
export function getMessyConfig(): MessyConfig {
  return { ...current };
}

/** Update the messy-data config (the caller resets the broker to apply). Values are
 *  clamped/validated so a bad patch can't produce an unusable config. */
export function setMessyConfig(patch: Partial<MessyConfig>): MessyConfig {
  const next: MessyConfig = { ...current };
  if (patch.on !== undefined) next.on = !!patch.on;
  if (patch.seed !== undefined && typeof patch.seed === "string" && patch.seed.trim()) next.seed = patch.seed.trim();
  if (patch.intensity !== undefined && Number.isFinite(patch.intensity)) next.intensity = Math.min(1, Math.max(0, patch.intensity));
  if (patch.gremlins !== undefined && Array.isArray(patch.gremlins)) next.gremlins = patch.gremlins.filter((g) => GREMLIN_IDS.has(g));
  current = next;
  return getMessyConfig();
}

// ── The gremlins (the catalogue of imperfections) ───────────────────────────────

/** Keys we never structurally break, so messified reads stay navigable (the mess is
 *  about VALUES and provenance, not about severing an issue from its project). */
const PROTECTED = new Set(["projectId"]);

/** Enum-ish fields whose free-form values arrive in inconsistent vocab/casing. */
const ENUM_KEYS = ["status", "priority", "healthStatus", "riskLevel", "impact", "urgency", "benefitStatus", "ragStatus", "severity", "likelihood"];
/** Date-ish fields that arrive in mixed/invalid formats. */
const DATE_KEYS = ["startDate", "dueDate", "createdAt", "updatedAt", "benefitStartDate", "benefitDueDate", "timestamp", "capturedAt"];
/** Boolean-ish fields that arrive as "yes"/1/"true" etc. */
const BOOL_KEYS = ["billable", "blocked", "read"];

/** Synonyms/re-spellings for common canonical enum values (keyed by normalised value). */
const ENUM_SYNONYMS: Record<string, string[]> = {
  done: ["Done", "DONE", "done ", "complete", "Completed", "COMPLETE", "finished", "Closed", "✅ Done"],
  in_progress: ["In Progress", "in progress", "IN-PROGRESS", "wip", "In-Progress", "started", "Doing"],
  todo: ["To Do", "TODO", "to-do", "Not Started", "new", "Open"],
  backlog: ["Backlog", "BACKLOG", "icebox", "Later", "triage"],
  blocked: ["Blocked", "BLOCKED", "on hold", "On-Hold", "waiting"],
  high: ["High", "HIGH", "hi", "P1", "Major"],
  urgent: ["Urgent", "URGENT", "critical", "P0", "Blocker"],
  medium: ["Medium", "MEDIUM", "med", "P2", "Normal"],
  low: ["Low", "LOW", "P3", "Minor", "trivial"],
};

/** Long / unicode / control-char content used by the unicode gremlin. */
const UNICODE_STRESS = [
  "Ünïcödé — RTL ‏مرحبا‏ mixed with LTR and a tab\tand newline\n",
  "🚀🔥💥 emoji flood 🧨🎯📊 with zero-width​​joiners",
  "A very very very very very very very very very very very very very long title that overflows every fixed-width column and truncation guard we have ".repeat(3),
  "<script>alert(1)</script> & <b>html-ish</b> \"quotes\" 'and' `backticks`",
  "trailing control chars [31m ansi-ish",
];

interface GremlinDef {
  id: string;
  label: string;
  description: string;
  /** Base firing rate before the global intensity scales it. */
  rate: number;
  /** Mutate a single (already shallow-copied) row in place. */
  apply(row: Row, rng: Rng): void;
}

function nonProtectedKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => !PROTECTED.has(k) && k !== "id");
}

const ROW_GREMLINS: GremlinDef[] = [
  {
    id: "nullify",
    label: "Null values",
    description: "Sets otherwise-present optional fields to null.",
    rate: 0.5,
    apply(row, rng) {
      const keys = nonProtectedKeys(row);
      const k = pick(rng, keys);
      if (k) row[k] = null;
    },
  },
  {
    id: "dropField",
    label: "Missing fields",
    description: "Deletes fields entirely, so consumers can't assume presence.",
    rate: 0.5,
    apply(row, rng) {
      const k = pick(rng, nonProtectedKeys(row));
      if (k) delete row[k];
    },
  },
  {
    id: "blankStrings",
    label: "Blank / whitespace strings",
    description: 'Empties or pads string values ("", "   ", " leading/trailing ").',
    rate: 0.4,
    apply(row, rng) {
      const strKeys = Object.keys(row).filter((k) => typeof row[k] === "string" && !PROTECTED.has(k));
      const k = pick(rng, strKeys);
      if (!k) return;
      const opt = pick(rng, ["", "   ", `  ${String(row[k])}  `, `${String(row[k])}\t`]);
      row[k] = opt ?? "";
    },
  },
  {
    id: "enumCasing",
    label: "Inconsistent enum vocab",
    description: 'Rewrites status/priority-style values ("done" → "Done"/"COMPLETE"/"finished").',
    rate: 0.7,
    apply(row, rng) {
      const present = ENUM_KEYS.filter((k) => typeof row[k] === "string" && row[k] !== "");
      const k = pick(rng, present);
      if (!k) return;
      const norm = String(row[k]).toLowerCase().replace(/\s+/g, "_");
      const syn = ENUM_SYNONYMS[norm];
      if (syn && chance(rng, 0.7)) {
        row[k] = pick(rng, syn) ?? row[k];
      } else {
        const v = String(row[k]);
        row[k] = pick(rng, [v.toUpperCase(), v.charAt(0).toUpperCase() + v.slice(1), ` ${v} `, v.replace(/_/g, " ")]) ?? v;
      }
    },
  },
  {
    id: "numberChaos",
    label: "Odd numbers",
    description: "Negative, zero, absurdly large, or number-as-string values.",
    rate: 0.5,
    apply(row, rng) {
      const numKeys = Object.keys(row).filter((k) => typeof row[k] === "number" && !PROTECTED.has(k));
      const k = pick(rng, numKeys);
      if (!k) return;
      const n = row[k] as number;
      row[k] = pick(rng, [-Math.abs(n), 0, n * 1_000_000, 1e15, `${n}`, "1,234", "N/A", `${n}abc`, Number.NaN]) ?? n;
    },
  },
  {
    id: "currencyChaos",
    label: "Currency chaos",
    description: 'Lowercases, symbolises or invalidates currency codes ("gbp", "£", "Euro", "XYZ").',
    rate: 0.8,
    apply(row, rng) {
      if (typeof row["currency"] !== "string") return;
      row["currency"] = pick(rng, ["gbp", "£", "$", "Euro", "EURO", "usd", "XYZ", "BTC", ""]) ?? row["currency"];
    },
  },
  {
    id: "dateChaos",
    label: "Broken dates",
    description: "Invalid, reformatted, or illogical dates (due before start).",
    rate: 0.5,
    apply(row, rng) {
      const present = DATE_KEYS.filter((k) => typeof row[k] === "string" && row[k] !== "");
      const k = pick(rng, present);
      if (!k) return;
      // If we have both a start and due date, sometimes make due precede start.
      if (k === "dueDate" && typeof row["startDate"] === "string" && chance(rng, 0.5)) {
        row["dueDate"] = "2000-01-01";
        return;
      }
      const v = String(row[k]);
      const dmy = v.slice(0, 10).split("-");
      row[k] = pick(rng, [
        "2026-13-40", // impossible month/day
        "not a date",
        dmy.length === 3 ? `${dmy[2]}/${dmy[1]}/${dmy[0]}` : v, // DD/MM/YYYY reformat
        `${v} 09:00`, // trailing time on a date-only field
        "0000-00-00",
      ]) ?? v;
    },
  },
  {
    id: "typeCoercion",
    label: "Wrong types",
    description: 'Booleans as "yes"/1, arrays as CSV strings, numbers as text.',
    rate: 0.5,
    apply(row, rng) {
      // Boolean-ish → stringy/number truthiness.
      const bk = pick(rng, BOOL_KEYS.filter((k) => k in row));
      if (bk) row[bk] = pick(rng, ["yes", "no", "true", "Y", 1, 0]) ?? row[bk];
      // labels array → CSV string.
      if (Array.isArray(row["labels"]) && chance(rng, 0.6)) row["labels"] = (row["labels"] as unknown[]).join(", ");
    },
  },
  {
    id: "unicodeStress",
    label: "Long / unicode text",
    description: "Injects overlong, emoji, RTL and control-char text into name/title/description.",
    rate: 0.3,
    apply(row, rng) {
      const target = pick(rng, ["title", "name", "description"].filter((k) => typeof row[k] === "string"));
      if (target) row[target] = pick(rng, UNICODE_STRESS) ?? row[target];
    },
  },
  {
    id: "missingSource",
    label: "Missing provenance",
    description: "Drops the `source` field, exercising the source-stamping guard.",
    rate: 0.3,
    apply(row, rng) {
      if ("source" in row && chance(rng, 0.7)) delete row["source"];
    },
  },
];

/** The stable id set (for env/patch validation). */
const GREMLIN_IDS = new Set([...ROW_GREMLINS.map((g) => g.id), "duplicateId"]);

/** Public catalogue for the dev-mode surface (id + human copy). */
export const MESSY_GREMLINS: { id: string; label: string; description: string }[] = [
  ...ROW_GREMLINS.map(({ id, label, description }) => ({ id, label, description })),
  { id: "duplicateId", label: "Duplicate ids", description: "Reuses another row's id, colliding identity across the set." },
];

// ── The transform ────────────────────────────────────────────────────────────

/** Which gremlins are active for a config (empty list ⇒ all of them). */
function activeRowGremlins(config: MessyConfig): GremlinDef[] {
  if (!config.gremlins.length) return ROW_GREMLINS;
  const wanted = new Set(config.gremlins);
  return ROW_GREMLINS.filter((g) => wanted.has(g.id));
}

/** Messify a single row deterministically. `salt` varies the mess per call site
 *  (e.g. the method name) while staying reproducible for a given seed. */
export function messifyRow(row: Row, config: MessyConfig, salt = ""): Row {
  const rng = mulberry32(hashSeed(`${config.seed}:${salt}:${String((row as { id?: unknown }).id ?? "")}`));
  return applyGremlins(row, rng, config);
}

/** Messify a list of rows deterministically (per-row mess + optional id collisions). */
export function messifyRows(rows: Row[], config: MessyConfig, salt = ""): Row[] {
  const gremlins = activeRowGremlins(config);
  const intensity = config.intensity;
  const out = rows.map((row, i) => {
    const rng = mulberry32(hashSeed(`${config.seed}:${salt}:${i}`));
    return applyGremlinsWith(row, rng, gremlins, intensity);
  });

  // Array-level: id collisions across the set (a distinct kind of imperfection).
  const duplicateOn = !config.gremlins.length || config.gremlins.includes("duplicateId");
  if (duplicateOn && out.length > 1) {
    const rng = mulberry32(hashSeed(`${config.seed}:${salt}:dupe`));
    for (let i = 1; i < out.length; i++) {
      if (chance(rng, intensity * 0.25)) {
        const donor = out[Math.floor(rng() * i)];
        const dupId = donor && (donor as { id?: unknown }).id;
        if (dupId !== undefined && "id" in out[i]!) out[i]!["id"] = dupId;
      }
    }
  }
  return out;
}

function applyGremlins(row: Row, rng: Rng, config: MessyConfig): Row {
  return applyGremlinsWith(row, rng, activeRowGremlins(config), config.intensity);
}

function applyGremlinsWith(row: Row, rng: Rng, gremlins: GremlinDef[], intensity: number): Row {
  const copy: Row = { ...row };
  for (const g of gremlins) {
    if (chance(rng, intensity * g.rate)) g.apply(copy, rng);
  }
  return copy;
}
