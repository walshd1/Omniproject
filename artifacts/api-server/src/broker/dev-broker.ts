import { readFileSync } from "node:fs";
import { backendCatalogue } from "@workspace/backend-catalogue";
import { DemoBroker } from "./demo";
import { loadDemoState } from "./demo-data";
import { buildReplayBroker } from "./replay";
import { readTape } from "./capture";
import { CAPABILITY_DOMAINS } from "../lib/capabilities";
import { isDevMode } from "../lib/dev-mode";
import type { ActorContext, Broker } from "./types";

/**
 * Dev broker — the DEVELOPER/debug broker (distinct from the DemoBroker, which is
 * the demonstration broker for training/sales). The dev broker lets you point the
 * gateway at any VENDOR profile × any DATA SOURCE and switch the combination on the
 * fly, with no real backend:
 *
 *   vendor  — present AS a vendor (e.g. openproject), gated to that vendor's
 *             DECLARED capabilities (from its JSON config). null ⇒ full surface.
 *   source  — where the read data comes from:
 *               demo     — the built-in sample dataset
 *               bundle   — a debug bundle's demo-state.json (ref = path)
 *               cassette — a captured traffic tape, replayed (ref = path)
 *
 * It composes the chosen data broker (a Proxy adds the vendor identity + capability
 * gating) rather than subclassing — the broker↔capabilities↔demo import cycle makes
 * `extends DemoBroker` evaluate before DemoBroker is initialised (a TDZ).
 *
 * Hard-gated to dev mode (`devBrokerFromEnv` returns null otherwise), and dev mode
 * itself refuses to boot in a production-like environment.
 */

export type DevDataSource = "demo" | "bundle" | "cassette";
export const DEV_DATA_SOURCES: DevDataSource[] = ["demo", "bundle", "cassette"];

export interface DevBrokerConfig {
  vendor: string | null;
  source: DevDataSource;
  ref: string | null;
}

// The live config — seeded from env, mutable at runtime for on-the-fly switching.
let current: DevBrokerConfig = {
  vendor: process.env["BROKER_SPOOF"]?.trim() || null,
  source: (DEV_DATA_SOURCES as string[]).includes(process.env["DEV_BROKER_SOURCE"]?.trim() ?? "")
    ? (process.env["DEV_BROKER_SOURCE"]!.trim() as DevDataSource)
    : "demo",
  ref: process.env["DEV_BROKER_REF"]?.trim() || null,
};

/** The current dev-broker config (vendor × data source). */
export function getDevBrokerConfig(): DevBrokerConfig {
  return { ...current };
}

/** Update the dev-broker config (the caller resets the broker singleton to apply). */
export function setDevBrokerConfig(patch: Partial<DevBrokerConfig>): DevBrokerConfig {
  current = { ...current, ...patch };
  return getDevBrokerConfig();
}

/** A vendor's declared capabilities from its JSON config, or null if unknown/none. */
function vendorCaps(vendor: string | null): Record<string, boolean> | null {
  if (!vendor) return null;
  const v = backendCatalogue().find((b) => b.id === vendor);
  return v ? (v.capabilities ?? {}) : null;
}

/** Build the data broker for a source (the reads come from here). */
function dataBroker(source: DevDataSource, ref: string | null): Broker {
  if (source === "cassette") {
    if (!ref) throw new Error("dev broker: 'cassette' source needs a tape path (ref)");
    return buildReplayBroker(readTape(ref));
  }
  if (source === "bundle") {
    if (!ref) throw new Error("dev broker: 'bundle' source needs a demo-state.json path (ref)");
    loadDemoState(JSON.parse(readFileSync(ref, "utf8")));
  }
  return new DemoBroker();
}

/** Overlay a vendor's identity + capability gating onto a data broker (composition). */
function withVendor(base: Broker, vendorId: string | null, caps: Record<string, boolean> | null): Broker {
  if (!vendorId || !caps) return base;
  const on = (d: string) => !!caps[d];
  const overrides: Record<string, unknown> = {
    kind: vendorId,
    live: false,
    vendorId,
    capabilities: async () => Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, on(d)])),
    listRaid: (ctx: ActorContext, pid: string) => (on("raid") ? base.listRaid(ctx, pid) : Promise.resolve([])),
    projectFinancials: (ctx: ActorContext, pid: string) => (on("financials") ? base.projectFinancials(ctx, pid) : Promise.resolve({})),
    resourceCapacity: (ctx: ActorContext, pid: string) => (on("resources") ? base.resourceCapacity(ctx, pid) : Promise.resolve([])),
    baseline: (ctx: ActorContext, pid: string) => (on("baseline") ? base.baseline(ctx, pid) : Promise.resolve(null)),
  };
  return new Proxy(base, {
    get(target, prop, receiver) {
      const key = String(prop);
      return key in overrides ? overrides[key] : Reflect.get(target, prop, receiver);
    },
  }) as Broker;
}

/** Build a dev broker for an explicit config. */
export function buildDevBroker(config: DevBrokerConfig): Broker {
  const base = dataBroker(config.source, config.ref);
  return withVendor(base, config.vendor, vendorCaps(config.vendor));
}

/**
 * The active dev broker, or null to fall back to the normal broker. Active only in
 * dev mode AND when something non-default is asked for (a spoofed vendor or a
 * non-demo data source) — so a plain dev build still gets the demonstration broker.
 */
export function devBrokerFromEnv(): Broker | null {
  if (!isDevMode()) return null;
  if (!current.vendor && current.source === "demo") return null;
  return buildDevBroker(current);
}
