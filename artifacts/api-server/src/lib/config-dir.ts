import fs from "node:fs";
import path from "node:path";
import { registerVendor, type VendorPlane } from "@workspace/backend-catalogue";
import { applySnapshot } from "./config-snapshot";
import { updateSettings } from "./settings";
import { setFieldRules, setRuleModes } from "./ruleset";
import { logger } from "./logger";

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

export interface ConfigDirSummary {
  dir: string | null;
  present: boolean;
  vendors: Record<string, number>;
  configApplied: boolean;
  rulesetsApplied: boolean;
  artifacts: number;
  warnings: string[];
  errors: string[];
}

function emptySummary(dir: string | null): ConfigDirSummary {
  return { dir, present: false, vendors: {}, configApplied: false, rulesetsApplied: false, artifacts: 0, warnings: [], errors: [] };
}

let lastSummary: ConfigDirSummary = emptySummary(null);

/** The most recent config-directory load result (for the admin status endpoint). */
export function configDirSummary(): ConfigDirSummary {
  return lastSummary;
}

/** Read every `*.json` file in a directory (empty list if it doesn't exist). */
function readJsonDir(dir: string): Array<{ file: string; data: unknown }> {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
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

  // Vendors: <dir>/vendors/<plane>/*.json → overlay (registerVendor validates).
  for (const plane of PLANES) {
    let count = 0;
    for (const { file, data } of safeRead(path.join(dir, "vendors", plane), summary)) {
      try {
        registerVendor(plane, data as { id: string });
        count++;
      } catch (err) {
        summary.errors.push(`vendors/${plane}/${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    summary.vendors[plane] = count;
  }

  // config.json: a settings snapshot → patch applied over the running settings.
  const configFile = path.join(dir, "config.json");
  if (fs.existsSync(configFile)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(configFile, "utf8"));
      const { patch, warnings } = applySnapshot(snapshot);
      updateSettings(patch);
      summary.configApplied = true;
      summary.warnings.push(...warnings);
    } catch (err) {
      summary.errors.push(`config.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // rulesets/: the governance ruleset (field rules + rule modes). Restrict-only —
  // setFieldRules/setRuleModes only accept well-formed, known, non-granting input.
  summary.rulesetsApplied = applyRuleset(path.join(dir, "rulesets"), summary);

  // artifacts/: things generated against our reference (n8n workflows, blueprints).
  // The gateway keeps them with the config but doesn't execute them — just inventory.
  const artifactsDir = path.join(dir, "artifacts");
  if (fs.existsSync(artifactsDir)) summary.artifacts = fs.readdirSync(artifactsDir).length;

  logger.info(
    { dir, vendors: summary.vendors, configApplied: summary.configApplied, rulesetsApplied: summary.rulesetsApplied, artifacts: summary.artifacts, errors: summary.errors.length },
    "loaded deployment config directory",
  );
  lastSummary = summary;
  return summary;
}

/** Apply rulesets/field-rules.json + rule-modes.json if present; true when either applied. */
function applyRuleset(dir: string, summary: ConfigDirSummary): boolean {
  let applied = false;
  const apply = (file: string, fn: (data: unknown) => void): void => {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) return;
    try {
      fn(JSON.parse(fs.readFileSync(full, "utf8")));
      applied = true;
    } catch (err) {
      summary.errors.push(`rulesets/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  apply("field-rules.json", (d) => setFieldRules(d));
  apply("rule-modes.json", (d) => setRuleModes(d as Record<string, unknown>));
  return applied;
}

/** Read a JSON directory, recording (not throwing) a parse error per file. */
function safeRead(dir: string, summary: ConfigDirSummary): Array<{ file: string; data: unknown }> {
  try {
    return readJsonDir(dir);
  } catch (err) {
    summary.errors.push(`${dir}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
