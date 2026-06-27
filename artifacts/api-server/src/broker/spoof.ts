import { backendCatalogue } from "@workspace/backend-catalogue";
import { DemoBroker } from "./demo";
import { CAPABILITY_DOMAINS } from "../lib/capabilities";
import { isDevMode } from "../lib/dev-mode";
import type { Broker } from "./types";

/**
 * Spoof broker — a DEV-ONLY thin layer that makes the gateway present AS a chosen
 * vendor (e.g. OpenProject) without a real backend. It reads the vendor's JSON
 * config from the catalogue and emits contract-compliant responses gated to that
 * vendor's DECLARED capability surface, so the overlay behaves as it would against
 * the real system of record:
 *
 *   BROKER_SPOOF=openproject   → kind "openproject", financials/raid/resources OFF
 *
 * It is a facade OVER a demo broker (compliant sample data) with the vendor's
 * identity + capabilities overlaid — enough to exercise capability gating, screens,
 * reports and the capture/replay tooling against a realistic vendor profile when
 * the real backend is unreachable. It is NOT the real API: writes are simulated.
 *
 * It COMPOSES the demo broker (via a Proxy) rather than subclassing it — the broker
 * barrel ↔ capabilities ↔ demo import cycle makes `extends DemoBroker` evaluate
 * before DemoBroker is initialised (a TDZ). Composition only touches DemoBroker at
 * call time, so it is cycle-safe.
 *
 * Selection is hard-gated to dev mode (`spoofBrokerFromEnv` returns null otherwise),
 * and dev mode itself refuses to boot in a production-like environment.
 */
export interface SpoofBroker extends Broker {
  readonly vendorId: string;
}

const enabled = (caps: Record<string, boolean>, domain: string) => !!caps[domain];

/** Build a broker that presents as `vendorId` with the given declared capabilities. */
export function makeSpoofBroker(vendorId: string, caps: Record<string, boolean>): SpoofBroker {
  const inner = new DemoBroker();

  // Only the identity + capability-gated surface differs from the demo broker.
  const overrides: Record<string, unknown> = {
    kind: vendorId,
    live: false,
    vendorId,
    capabilities: async () => Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, enabled(caps, d)])),
    listRaid: (ctx: never, projectId: string) => (enabled(caps, "raid") ? inner.listRaid(ctx, projectId) : Promise.resolve([])),
    projectFinancials: () => (enabled(caps, "financials") ? inner.projectFinancials() : Promise.resolve({})),
    resourceCapacity: () => (enabled(caps, "resources") ? inner.resourceCapacity() : Promise.resolve([])),
    baseline: (ctx: never, projectId: string) => (enabled(caps, "baseline") ? inner.baseline(ctx, projectId) : Promise.resolve(null)),
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      const key = String(prop);
      if (key in overrides) return overrides[key];
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as SpoofBroker;
}

/**
 * Build a spoof broker from `BROKER_SPOOF` when dev mode is active and the vendor
 * exists; otherwise null (so the caller falls back to the normal broker). Never
 * spoofs in production — `isDevMode()` is false there.
 */
export function spoofBrokerFromEnv(): SpoofBroker | null {
  if (!isDevMode()) return null;
  const id = process.env["BROKER_SPOOF"]?.trim();
  if (!id) return null;
  const vendor = backendCatalogue().find((b) => b.id === id);
  if (!vendor) return null;
  return makeSpoofBroker(id, vendor.capabilities ?? {});
}
