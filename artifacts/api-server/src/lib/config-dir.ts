import fs from "node:fs";
import path from "node:path";
import { openConfig, isSealedConfig } from "./config-crypto";
import { registerVendor, type VendorPlane } from "@workspace/backend-catalogue";
import { applySnapshot } from "./config-snapshot";
import { updateSettings } from "./settings";
import { setFieldRules, setRuleModes } from "./ruleset";
import { setHealthThresholds } from "./health-watch";
import { registerAutonomousActor } from "./autonomous";
import type { Role } from "./rbac";
import { logger } from "./logger";
import { safeParseJson } from "./safe-json";

/** Roles a config-declared autonomous actor may be capped at — the autonomous tiers only. An operator
 *  must NOT be able to mint a pmo/admin (authority) autonomous principal from a JSON file. */
const AUTONOMOUS_ACTOR_ROLES = new Set<Role>(["viewer", "contributor"]);

/**
 * Deployment config directory loader (OMNI_CONFIG_DIR).
 *
 * An OmniProject deployment's config is a FOLDER OF JSON the operator keeps and
 * mounts; the gateway READS it at boot and holds nothing durable itself (the JSON
 * on disk is the persistence). The same folder is what the admin "lock this
 * config" export dumps — read and dump share one shape.
 *
 *   <dir>/config.json              settings + label overrides (a config snapshot)
 *   <dir>/vendors/<plane>/*.json   add / override vendors (validated per plane)
 *   <dir>/rulesets/field-rules.json + rule-modes.json   the governance ruleset
 *   <dir>/artifacts/               things generated against our reference (kept)
 *
 * Every vendor file is schema-validated (the same schema the author designed
 * against); an invalid file is logged + skipped, never crashes boot. This is the
 * exact shape the admin "lock this config" export dumps — read ≡ dump. The load
 * summary is kept for the admin status endpoint.
 */

const PLANES: VendorPlane[] = ["backends", "brokers", "notifications", "outputs"];

/** One part of the config folder: reads its files and records into the summary. */
interface ConfigLoader {
  name: string;
  load(dir: string, summary: ConfigDirSummary): void;
}

export interface ConfigDirSummary {
  dir: string | null;
  present: boolean;
  vendors: Record<string, number>;
  configApplied: boolean;
  rulesetsApplied: boolean;
  autonomousActors: number;
  artifacts: number;
  warnings: string[];
  errors: string[];
}

/** A thrown value's message, or its string form when it isn't an `Error`. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptySummary(dir: string | null): ConfigDirSummary {
  return { dir, present: false, vendors: {}, configApplied: false, rulesetsApplied: false, autonomousActors: 0, artifacts: 0, warnings: [], errors: [] };
}

let lastSummary: ConfigDirSummary = emptySummary(null);

/** The most recent config-directory load result (for the admin status endpoint). */
export function configDirSummary(): ConfigDirSummary {
  return lastSummary;
}

/** Read a config file, transparently decrypting it if sealed at rest (else plaintext).
 *  A sealed file that won't open (wrong key / tampered) throws a clear error. Parsed via the
 *  prototype-pollution-safe reviver — this is operator-mounted config, but a file dropped into
 *  the watched directory by mistake (or a compromised mount) shouldn't be able to plant a
 *  `__proto__`/`constructor` key that pollutes Object.prototype once merged into settings. */
function readConfigJson(file: string): unknown {
  const raw = fs.readFileSync(file, "utf8");
  if (!isSealedConfig(raw)) return safeParseJson(raw); // plaintext (not a sealed c1./c2. token)
  const opened = openConfig(raw);
  if (opened === null) throw new Error(`${path.basename(file)}: could not decrypt (wrong config key?)`);
  return safeParseJson(opened);
}

/** Read every `*.json` file in a directory (empty list if it doesn't exist). */
function readJsonDir(dir: string): Array<{ file: string; data: unknown }> {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, data: readConfigJson(path.join(dir, f)) }));
}

/**
 * Load the deployment config directory, overlaying its vendors and applying its
 * config.json. Returns a summary; safe to call with no dir set (no-op). The dir
 * defaults to OMNI_CONFIG_DIR.
 */
export function loadConfigDir(dir = process.env["OMNI_CONFIG_DIR"]?.trim()): ConfigDirSummary {
  const summary = emptySummary(dir ?? null);
  if (!dir) { lastSummary = summary; return summary; }
  if (!fs.existsSync(dir)) {
    summary.errors.push(`OMNI_CONFIG_DIR "${dir}" does not exist`);
    lastSummary = summary;
    return summary;
  }
  summary.present = true;

  // Each part of the config folder is a registered loader — to support a new
  // subdir (views/, screens/, …) add one entry, not a new branch here.
  for (const loader of LOADERS) {
    try {
      loader.load(dir, summary);
    } catch (err) {
      summary.errors.push(`${loader.name}: ${errMsg(err)}`);
    }
  }

  logger.info(
    { dir, vendors: summary.vendors, configApplied: summary.configApplied, rulesetsApplied: summary.rulesetsApplied, artifacts: summary.artifacts, errors: summary.errors.length },
    "loaded deployment config directory",
  );
  lastSummary = summary;
  return summary;
}

// ── Loaders (the registry) ─────────────────────────────────────────────────────

/** vendors/<plane>/*.json → overlay (registerVendor validates each per its schema). */
function loadVendors(dir: string, summary: ConfigDirSummary): void {
  for (const plane of PLANES) {
    let count = 0;
    for (const { file, data } of safeRead(path.join(dir, "vendors", plane), summary)) {
      try {
        registerVendor(plane, data as { id: string });
        count++;
      } catch (err) {
        summary.errors.push(`vendors/${plane}/${file}: ${errMsg(err)}`);
      }
    }
    summary.vendors[plane] = count;
  }
}

/** config.json → a settings snapshot applied over the running settings. */
function loadConfigJson(dir: string, summary: ConfigDirSummary): void {
  const file = path.join(dir, "config.json");
  if (!fs.existsSync(file)) return;
  try {
    const { patch, warnings } = applySnapshot(readConfigJson(file));
    updateSettings(patch);
    summary.configApplied = true;
    summary.warnings.push(...warnings);
  } catch (err) {
    summary.errors.push(`config.json: ${errMsg(err)}`);
  }
}

/** rulesets/field-rules.json + rule-modes.json — restrict-only (setFieldRules/setRuleModes never grant). */
function loadRulesets(dir: string, summary: ConfigDirSummary): void {
  const apply = (file: string, fn: (data: unknown) => void): void => {
    const full = path.join(dir, "rulesets", file);
    if (!fs.existsSync(full)) return;
    try {
      fn(readConfigJson(full));
      summary.rulesetsApplied = true;
    } catch (err) {
      summary.errors.push(`rulesets/${file}: ${errMsg(err)}`);
    }
  };
  apply("field-rules.json", (d) => setFieldRules(d));
  apply("rule-modes.json", (d) => setRuleModes(d as Record<string, unknown>));
  apply("health-thresholds.json", (d) => setHealthThresholds(d));
}

/** autonomous-actors.json — the config extension point for the autonomous-actor allowlist
 *  (`[{ id, maxRole }]`). Each entry raises/lowers the max role an actor id may run as, capped at the
 *  autonomous tiers (viewer/contributor) — never a pmo/admin authority. This is the documented
 *  "operator extends this via config (registerAutonomousActor)" seam, which previously had no loader. */
function loadAutonomousActors(dir: string, summary: ConfigDirSummary): void {
  const file = path.join(dir, "autonomous-actors.json");
  if (!fs.existsSync(file)) return;
  try {
    const data = readConfigJson(file);
    if (!Array.isArray(data)) throw new Error("expected an array of { id, maxRole }");
    for (const entry of data as Array<{ id?: unknown; maxRole?: unknown }>) {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const maxRole = entry.maxRole;
      if (!id) { summary.errors.push("autonomous-actors.json: an entry is missing a string id"); continue; }
      if (typeof maxRole !== "string" || !AUTONOMOUS_ACTOR_ROLES.has(maxRole as Role)) {
        summary.errors.push(`autonomous-actors.json: actor "${id}" — maxRole must be one of viewer|contributor (got "${String(maxRole)}")`);
        continue;
      }
      registerAutonomousActor(id, maxRole as Role);
      summary.autonomousActors++;
    }
  } catch (err) {
    summary.errors.push(`autonomous-actors.json: ${errMsg(err)}`);
  }
}

/** artifacts/ — things generated against our reference; kept with the config, just inventoried. */
function loadArtifacts(dir: string, summary: ConfigDirSummary): void {
  const artifactsDir = path.join(dir, "artifacts");
  if (fs.existsSync(artifactsDir)) summary.artifacts = fs.readdirSync(artifactsDir).length;
}

const LOADERS: ConfigLoader[] = [
  { name: "vendors", load: loadVendors },
  { name: "config", load: loadConfigJson },
  { name: "rulesets", load: loadRulesets },
  { name: "autonomous-actors", load: loadAutonomousActors },
  { name: "artifacts", load: loadArtifacts },
];

/** Read a JSON directory, recording (not throwing) a parse error per file. */
function safeRead(dir: string, summary: ConfigDirSummary): Array<{ file: string; data: unknown }> {
  try {
    return readJsonDir(dir);
  } catch (err) {
    summary.errors.push(`${dir}: ${errMsg(err)}`);
    return [];
  }
}
