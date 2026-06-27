import { backendCatalogue } from "@workspace/backend-catalogue";
import { CAPABILITY_DOMAINS } from "../lib/capabilities";
import type { ActorContext, Broker } from "./types";

/**
 * Vendor profile overlay — present a broker AS a specific vendor by overlaying that
 * vendor's identity + DECLARED capability surface (from its JSON config) onto an
 * underlying data broker. A Proxy (composition, not subclassing) so it is cycle-safe
 * and works over any base broker.
 *
 * Used in two places:
 *  - the DEV broker (over demo/bundle/cassette data), gated to dev mode;
 *  - the DEMO broker, so a prospect can preview how the product looks on THEIR stack
 *    (e.g. OpenProject) over sample data — a sales/training aid, production-safe
 *    because it only ever gates demo data and never touches a real backend.
 *
 * It does NOT fake a live integration: `live` stays false and writes still go to
 * whatever the base broker is (the demo/sample store). It only shapes the
 * capability surface so the UI gates panels exactly as the real vendor would.
 */

/** A vendor's declared capabilities from its catalogue JSON, or null if unknown. */
export function vendorCapabilities(vendorId: string): Record<string, boolean> | null {
  const v = backendCatalogue().find((b) => b.id === vendorId);
  return v ? (v.capabilities ?? {}) : null;
}

/** Is this a real vendor id (not a neutral "all"/"none"/empty selector)? */
export function isVendorId(value: string | null | undefined): value is string {
  if (!value || value === "all" || value === "none") return false;
  return !!vendorCapabilities(value);
}

/**
 * Decide the demo vendor to present, with the hard rule that a thin-file spoof
 * NEVER appears over real data. It applies ONLY in pure demo mode (no real backend
 * connected) and not when the dev broker is active (which carries its own vendor) —
 * so a production deployment with a real broker shows the REAL vendor, never a
 * `-demo` facade. Returns the vendor id to flavour the demo with, or null.
 */
export function demoVendorFor(opts: { devActive: boolean; realBackend: boolean; source: string | null | undefined }): string | null {
  if (opts.devActive || opts.realBackend) return null; // real data / dev broker ⇒ no demo spoof
  return isVendorId(opts.source) ? opts.source : null;
}

/** Overlay a vendor's identity + capability gating onto a base broker. */
export function applyVendorProfile(base: Broker, vendorId: string | null, caps?: Record<string, boolean> | null): Broker {
  const c = caps ?? (vendorId ? vendorCapabilities(vendorId) : null);
  if (!vendorId || !c) return base;
  const on = (d: string) => !!c[d];
  const overrides: Record<string, unknown> = {
    // The presented kind carries a `-demo` suffix: this is a thin-file vendor
    // spoof over sample/recorded data, NOT a live integration, and the name must
    // make that unmistakable wherever it surfaces. `vendorId` keeps the clean id.
    kind: `${vendorId}-demo`,
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
