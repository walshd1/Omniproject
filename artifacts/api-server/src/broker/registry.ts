import { getBroker } from "./index";
import { getBrokerDef, brokerSupport, BROKER_CAPABILITY_KEYS } from "@workspace/backend-catalogue";
import type { TransportMethod } from "@workspace/backend-catalogue";

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

/** What a command needs of the broker that serves it. */
export interface CommandIntent {
  /** The backend transport the command must be driven over (e.g. "native-node" ⇒ n8n). */
  transport?: TransportMethod;
  /** A broker capability the command requires (e.g. "eventsOutbound"). */
  capability?: string;
}

/** Can this connected broker drive a given transport? Demo serves any transport;
 *  a live broker must declare it in the catalogue. */
function servesTransport(b: ConnectedBroker, transport: TransportMethod): boolean {
  if (!b.live) return true;
  const def = getBrokerDef(b.kind);
  return !!def && def.transports.includes(transport);
}

/**
 * Per-kind command ROUTING — choose which connected broker KIND should serve a
 * command, given what it needs (transport + capability). The decision rule: keep
 * the PRIMARY (the live data/command hop) whenever it qualifies — heterogeneous
 * fan-out is the exception, not the default — otherwise the first eligible connected
 * broker, else fall back to the primary.
 *
 * IMPORTANT (honest scope): this is the routing DECISION. Actual dispatch still goes
 * through `getBroker()` — there's one concrete adapter (the n8n/HTTP broker) plus the
 * demo. Routing a command to a genuinely different connected platform additionally
 * needs per-kind adapter instances bound to each platform's endpoint; that's the
 * remaining work. Wiring this decision in first makes the selection explicit,
 * testable, and ready for those adapters.
 */
export function brokerForCommand(intent: CommandIntent = {}): string {
  const connected = connectedBrokers();
  const primary = connected.find((b) => b.primary)!;
  const eligible = connected.filter((b) => {
    if (intent.capability && !brokersSupporting(intent.capability).includes(b.kind)) return false;
    if (intent.transport && !servesTransport(b, intent.transport)) return false;
    return true;
  });
  if (eligible.some((b) => b.primary)) return primary.kind;
  return eligible[0]?.kind ?? primary.kind;
}
