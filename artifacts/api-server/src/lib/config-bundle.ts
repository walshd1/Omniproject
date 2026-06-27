import { vendorOverlayEntries } from "@workspace/backend-catalogue";
import { buildSnapshot } from "./config-snapshot";
import { getSettings } from "./settings";
import { getFieldRules, getRuleModes } from "./ruleset";
import { buildZip, type ZipEntry } from "./zip";

/**
 * "Lock this config" export — dump the current effective config as the EXACT
 * folder-of-JSON the config-directory loader reads (read ≡ dump). The customer
 * keeps the bundle and mounts it as OMNI_CONFIG_DIR to persist their look-and-feel;
 * the gateway itself stores nothing.
 *
 *   config.json              the settings snapshot (settings + label overrides)
 *   vendors/<plane>/<id>.json the deployment's overlay vendors (its own additions)
 *   rulesets/field-rules.json + rule-modes.json   the governance ruleset
 *
 * Contains only CONFIG — never customer project/issue data (that is brokered live).
 */

/** Build the config bundle as a ZIP buffer mirroring the OMNI_CONFIG_DIR layout. */
export function buildConfigBundle(): Buffer {
  const entries: ZipEntry[] = [];
  const addJson = (name: string, obj: unknown): void => {
    entries.push({ name, data: Buffer.from(JSON.stringify(obj, null, 2) + "\n") });
  };

  addJson("config.json", buildSnapshot(getSettings()));

  const overlay = vendorOverlayEntries();
  for (const [plane, defs] of Object.entries(overlay)) {
    for (const def of defs) addJson(`vendors/${plane}/${def.id}.json`, def);
  }

  addJson("rulesets/field-rules.json", getFieldRules());
  addJson("rulesets/rule-modes.json", getRuleModes());

  return buildZip(entries);
}
