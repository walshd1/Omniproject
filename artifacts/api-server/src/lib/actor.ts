/**
 * Shared actor-identity helpers over the broker's `ActorContext`. ONE definition of how a request's
 * actor is turned into a stored audit label, instead of the same `email ?? name ?? sub ?? null`
 * one-liner hand-rolled in every feature's write path.
 */
import type { ActorContext } from "../broker/types";

/** The human-readable label recorded on a write's `*By` audit field: the actor's email, then name, then
 *  subject id, or null when the context carries none. */
export const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;
