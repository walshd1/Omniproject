import fs from "node:fs";
import path from "node:path";
import { backendCatalogue, brokerCatalogue } from "@workspace/backend-catalogue";
import { buildZip, type ZipEntry } from "./zip";
import { buildSnapshot } from "./config-snapshot";
import { isSealedConfig } from "./config-crypto";
import { getSettings } from "./settings";
import { configDirSummary } from "./config-dir";
import { getDemoState } from "./data";
import { capturePath } from "../broker/capture";
import { devModeStatus } from "./dev-mode";
import { featureStatus } from "./feature-modules";
import { presenceStats } from "./presence-hub";
import { singleFlightStats } from "../broker/single-flight";
import { readCacheStats } from "../broker/cache";
import { aiStatus } from "./ai";
import { aiGovernanceStatus } from "./ai-governance";
import { auditStatus } from "./audit";
import { sttStatus } from "./stt";
import { licenseSummary } from "./license";

/**
 * Debug bundle — a single reproducible dump that lets you replicate an issue on
 * another instance. It gathers, for a point in time:
 *
 *  - `config.json`       — the gateway configuration snapshot (no secrets).
 *  - `config-dir/*.json` — the loaded JSON config files (OMNI_CONFIG_DIR), if any — EXCLUDING
 *                          any file that's sealed (secret) at rest (vault, rate-card, SCIM,
 *                          security-state, …), so the bundle never carries even a ciphertext
 *                          copy of a secret store. `manifest.json`'s `skippedSealedConfigFiles`
 *                          names what was left out.
 *  - `vendors.json`      — the loaded backend + broker catalogues (the definitions
 *                          the engines are running, so a mismatch is visible).
 *  - `feature-modules.json` — the optional feature-module status (which modules are
 *                          enabled / loaded / need a restart), so a repro shows the
 *                          exact module set that was active.
 *  - `runtime-posture.json` — non-secret governance posture (AI provider + guardrails,
 *                          audit level, STT, licence, per-capability surface/store), so
 *                          the policy context that shaped behaviour is visible.
 *  - `demo-state.json`   — the in-memory dataset (projects/issues/RAID).
 *  - `capture-tape.jsonl`— the broker/notify/export traffic captured this period
 *                          (when BROKER_CAPTURE is armed), for replay.
 *  - `manifest.json` / `README.md` — what's inside + how to reload.
 *
 * RELOAD on another (non-prod) instance: apply `config.json` via Setup → Restore,
 * point `DEV_PERSIST_FILE` at `demo-state.json`, and replay `capture-tape.jsonl`
 * with `pnpm broker:replay`. That reconstructs the config, data and traffic that
 * produced the issue.
 *
 * DEV-ONLY: the bundle contains real activity/data, so it is gated to non-prod
 * (the route refuses in production / outside stateful dev mode).
 */

export interface DebugBundleManifest {
  schema: "omniproject/debug-bundle";
  version: 1;
  generatedAt: string;
  env: string;
  surfaces: ReturnType<typeof devModeStatus>["surfaces"];
  contents: string[];
  /** config-dir files left out because they're sealed (secret) at rest — see configDirEntries. */
  skippedSealedConfigFiles: string[];
}

/** Read every *.json file in OMNI_CONFIG_DIR as bundle entries (empty if unset/absent). Sealed
 *  files (vault, rate-card, SCIM, security-state, …) are recognised by content — not by
 *  filename — and excluded: the bundle is a non-secret repro dump, not a secret-store copy,
 *  even when that copy would only be ciphertext. `skipped` names what was left out so the
 *  omission is visible rather than a silent, confusing gap in the dump. */
function configDirEntries(): { entries: ZipEntry[]; skipped: string[] } {
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  if (!dir || !fs.existsSync(dir)) return { entries: [], skipped: [] };
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) { walk(full, `${prefix}${name}/`); continue; }
      if (!name.endsWith(".json")) continue;
      const data = fs.readFileSync(full);
      if (isSealedConfig(data.toString("utf8"))) { skipped.push(`${prefix}${name}`); continue; }
      entries.push({ name: `config-dir/${prefix}${name}`, data });
    }
  };
  walk(dir, "");
  return { entries, skipped };
}

/** The capture tape as a bundle entry, when armed and present. */
function captureEntry(): ZipEntry[] {
  const p = capturePath();
  if (!p || !fs.existsSync(p)) return [];
  return [{ name: "capture-tape.jsonl", data: fs.readFileSync(p) }];
}

/** A bundle entry whose content is pretty-printed JSON — the shape every non-file entry shares. */
function jsonEntry(name: string, value: unknown): ZipEntry {
  return { name, data: Buffer.from(JSON.stringify(value, null, 2), "utf8") };
}

const README = (now: string, skippedSealedConfigFiles: string[]): string =>
  "# OmniProject debug bundle\n\n" +
  `Generated ${now}.\n\n` +
  "A reproducible dump for sharing on a GitHub issue / replaying on another instance.\n\n" +
  "## Contents\n" +
  "- `config.json` — gateway configuration snapshot (no secrets; those live in env).\n" +
  "- `config-dir/*.json` — the loaded JSON config files (OMNI_CONFIG_DIR), if any — excluding\n" +
  "  any file sealed (secret) at rest (vault, rate-card, SCIM, security-state, …); never even a\n" +
  "  ciphertext copy of a secret store. See `manifest.json`'s `skippedSealedConfigFiles`.\n" +
  (skippedSealedConfigFiles.length > 0
    ? `  Excluded this run: ${skippedSealedConfigFiles.map((f) => `\`${f}\``).join(", ")}.\n`
    : "") +
  "- `vendors.json` — the loaded backend + broker catalogues (the running definitions).\n" +
  "- `feature-modules.json` — optional feature-module status (enabled / loaded / needs restart).\n" +
  "- `runtime-posture.json` — non-secret governance posture (AI/guardrails/audit/STT/licence/capabilities).\n" +
  "- `demo-state.json` — the in-memory demo dataset (projects/issues/RAID).\n" +
  "- `capture-tape.jsonl` — captured broker/notify/export traffic (if BROKER_CAPTURE was armed).\n" +
  "- `manifest.json` — machine-readable index of this bundle.\n\n" +
  "## Reload (on a NON-production instance)\n" +
  "1. Apply `config.json` via **Setup → Restore**.\n" +
  "2. Point `DEV_PERSIST_FILE` at a copy of `demo-state.json` and restart.\n" +
  "3. Replay the traffic: `pnpm broker:replay capture-tape.jsonl` (add `--redrive` to\n" +
  "   re-issue the recorded instructions against this instance and diff the results).\n\n" +
  "Dev mode is a debugging aid; it is **inert in production** and never bundles there.\n";

interface DebugBundleData {
  config: ReturnType<typeof buildSnapshot>;
  vendors: { backends: ReturnType<typeof backendCatalogue>; brokers: ReturnType<typeof brokerCatalogue>; configDir: ReturnType<typeof configDirSummary> };
  features: ReturnType<typeof featureStatus>;
  posture: {
    devMode: ReturnType<typeof devModeStatus>;
    ai: ReturnType<typeof aiStatus>;
    aiGovernance: ReturnType<typeof aiGovernanceStatus>;
    audit: ReturnType<typeof auditStatus>;
    stt: ReturnType<typeof sttStatus>;
    license: ReturnType<typeof licenseSummary>;
    capabilityStates: ReturnType<typeof getSettings>["capabilityStates"];
    presence: ReturnType<typeof presenceStats>;
    brokerReads: { singleFlight: ReturnType<typeof singleFlightStats>; cache: ReturnType<typeof readCacheStats> };
  };
  state: ReturnType<typeof getDemoState>;
  dirEntries: ZipEntry[];
  skippedSealedConfigFiles: string[];
  tapeEntries: ZipEntry[];
}

/** Gather a point-in-time snapshot from every subsystem the bundle covers. Read-only; no
 *  serialization/zip concerns here — that's `toZipEntries`/`buildManifest`, below. */
function gatherDebugData(): DebugBundleData {
  const config = buildSnapshot(getSettings());
  const vendors = { backends: backendCatalogue(), brokers: brokerCatalogue(), configDir: configDirSummary() };
  const state = getDemoState();
  const { entries: dirEntries, skipped: skippedSealedConfigFiles } = configDirEntries();
  const tapeEntries = captureEntry();

  const features = featureStatus();
  // A non-secret snapshot of the runtime governance posture — AI provider + guardrails, audit
  // level, STT, licence and the per-capability surface/store states — so a repro shows the policy
  // context, not just the data. Every field here is a flag/level/limit; no keys or tokens.
  const posture = {
    devMode: devModeStatus(),
    ai: aiStatus(),
    aiGovernance: aiGovernanceStatus(),
    audit: auditStatus(),
    stt: sttStatus(),
    license: licenseSummary(),
    capabilityStates: getSettings().capabilityStates,
    // Live, ephemeral collaboration footprint (rooms/connections currently held) — a repro shows
    // whether real-time presence was active, not just the static config.
    presence: presenceStats(),
    // Broker read-path efficiency: single-flight coalescing (always on) + the opt-in TTL cache, so a
    // repro shows how much upstream load was being saved.
    brokerReads: { singleFlight: singleFlightStats(), cache: readCacheStats() },
  };

  return { config, vendors, features, posture, state, dirEntries, skippedSealedConfigFiles, tapeEntries };
}

/** Serialize gathered data to the bundle's ZIP entries (excluding manifest/README, added by the
 *  caller once the entry list — and hence the manifest's `contents` — is final). */
function toZipEntries(data: DebugBundleData): ZipEntry[] {
  return [
    jsonEntry("config.json", data.config),
    jsonEntry("vendors.json", data.vendors),
    jsonEntry("feature-modules.json", data.features),
    jsonEntry("runtime-posture.json", data.posture),
    jsonEntry("demo-state.json", data.state),
    ...data.dirEntries,
    ...data.tapeEntries,
  ];
}

/** Build the manifest from the final entry list (so `contents` lists everything the bundle
 *  actually carries) plus the generation time + dev-mode surfaces. */
function buildManifest(now: string, entries: ZipEntry[], skippedSealedConfigFiles: string[]): DebugBundleManifest {
  return {
    schema: "omniproject/debug-bundle",
    version: 1,
    generatedAt: now,
    env: process.env["NODE_ENV"] ?? "development",
    surfaces: devModeStatus().surfaces,
    contents: entries.map((e) => e.name),
    skippedSealedConfigFiles,
  };
}

/** Assemble the bundle entries + manifest for a given timestamp. */
export function buildDebugBundleEntries(now: string): { manifest: DebugBundleManifest; entries: ZipEntry[] } {
  const data = gatherDebugData();
  const entries = toZipEntries(data);
  const manifest = buildManifest(now, entries, data.skippedSealedConfigFiles);

  entries.unshift(jsonEntry("manifest.json", manifest));
  entries.unshift({ name: "README.md", data: Buffer.from(README(now, data.skippedSealedConfigFiles), "utf8") });
  return { manifest, entries };
}

/** Build the bundle as a ZIP buffer. */
export function buildDebugBundleZip(now: string): Buffer {
  return buildZip(buildDebugBundleEntries(now).entries);
}
