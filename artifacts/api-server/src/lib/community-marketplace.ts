import type { RegistryItem } from "./registry";

/**
 * COMMUNITY MARKETPLACE seam (roadmap: org registry → optional community release). This is the connector
 * boundary for an AS-YET-UNBUILT online marketplace: when an admin releases an approved registry item to the
 * community, we call `publish` here. By default NO marketplace is connected — publish is a no-op that reports
 * "not connected", and the item is still marked `community` LOCALLY (queued), so nothing is lost. A future
 * online marketplace registers a real implementation via {@link registerCommunityMarketplace} and existing
 * releases can be re-published. Keeping this a seam (like the broker) means the registry never depends on a
 * concrete remote — exactly the pattern used across the codebase.
 */

export interface PublishResult {
  /** Whether the item reached a connected marketplace. */
  ok: boolean;
  /** The id the marketplace assigned (stored as the item's `communityRef`), when published. */
  communityRef?: string;
  /** Why publish didn't reach a marketplace (e.g. none connected), for the caller to surface. */
  reason?: string;
}

export interface CommunityMarketplace {
  /** Whether a real online marketplace is connected right now. */
  configured(): boolean;
  /** A short name for the connected marketplace (for UI), or null when none. */
  name(): string | null;
  /** Publish a released item outward. Best-effort; never throws (returns `{ok:false, reason}` instead). */
  publish(item: RegistryItem): Promise<PublishResult>;
}

/** The default: no marketplace connected. Release still marks the item `community` locally (queued). */
const UNCONFIGURED: CommunityMarketplace = {
  configured: () => false,
  name: () => null,
  publish: async () => ({ ok: false, reason: "no community marketplace is connected — the item is released locally and will publish once a marketplace is connected" }),
};

let current: CommunityMarketplace = UNCONFIGURED;

/** Register the connected online marketplace (a future integration wires this at startup). */
export function registerCommunityMarketplace(impl: CommunityMarketplace): void { current = impl; }

/** Reset to the unconfigured default (test seam). */
export function resetCommunityMarketplace(): void { current = UNCONFIGURED; }

/** The active marketplace connector (the unconfigured no-op until a real one is registered). */
export function getCommunityMarketplace(): CommunityMarketplace { return current; }
