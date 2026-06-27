import { getBroker } from "./index";
import { getBrokerDef, brokerSupport, BROKER_CAPABILITY_KEYS } from "@workspace/backend-catalogue";

/**
 * The broker router / registry — which broker KINDS are connected to this
 * deployment, so the capability resolver can UNION what they collectively support
 * and a router can pick which kind serves a given need.
 *
 * Reality of the seam: OmniProject talks to every broker platform through the SAME
 * HTTP contract, so "many brokers at once" doesn't mean many adapters in the
 * gateway — it means several broker platforms wired below the seam (e.g. n8n for
 * the live data hop + Make for outbound events), each speaking that one contract.
 * This registry is the single place that knows the set.
 *
 * The connected set is: the ACTIVE broker's kind (the live data/command hop —
 * `getBroker()`, always present and PRIMARY) PLUS any extra kinds declared in
 * `BROKER_KINDS` (a comma list of catalogue broker ids). Unknown ids are dropped,
 * so a typo can never surface phantom capabilities — the same discipline the
 * incompatibility guard enforces on the asset side.
 */

export interface ConnectedBroker {
  kind: string;
  /** Backed by a real backend (vs the in-process demo). */
  live: boolean;
  /** The active data/command hop (`getBroker()`)? Exactly one connected broker is primary. */
  primary: boolean;
}

/** Extra connected broker kinds declared in the environment, validated against the
 *  catalogue (an id with no definition is dropped). */
function declaredKinds(): string[] {
  const raw = process.env["BROKER_KINDS"]?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((k) => k && !!getBrokerDef(k));
}

/**
 * The brokers connected to this deployment. The active broker is PRIMARY (the live
 * data/command hop); each distinct declared extra kind is an additional connected
 * broker. De-duplicated by kind, primary first.
 */
export function connectedBrokers(): ConnectedBroker[] {
  const active = getBroker();
  const out: ConnectedBroker[] = [{ kind: active.kind, live: active.live, primary: true }];
  const seen = new Set([active.kind]);
  for (const kind of declaredKinds()) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, live: true, primary: false });
  }
  return out;
}

/** The DISTINCT connected broker kinds — the list the capability resolver unions over. */
export function connectedBrokerKinds(): string[] {
  return connectedBrokers().map((b) => b.kind);
}

/**
 * The routing primitive: which connected broker kinds can serve a given capability
 * (e.g. "who can deliver `eventsOutbound`?"). A non-live (demo) broker simulates
 * the full reference broker, so it matches every broker capability key. The PRIMARY
 * is listed first, so a caller that wants a single target can take `[0]`.
 */
export function brokersSupporting(capabilityKey: string): string[] {
  return connectedBrokers()
    .filter((b) => {
      if (!b.live) return BROKER_CAPABILITY_KEYS.includes(capabilityKey as (typeof BROKER_CAPABILITY_KEYS)[number]);
      return brokerSupport(b.kind)[capabilityKey] === true;
    })
    .map((b) => b.kind);
}
