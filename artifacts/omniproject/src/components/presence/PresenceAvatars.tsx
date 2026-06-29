import { peerInitials, type PresencePeer } from "../../lib/presence";

/**
 * Presence avatars — a compact row of coloured initials for the other people currently on this
 * surface (the "presence" feature module). Read-only and decorative-with-meaning: each avatar
 * carries the person's name (title + sr-only) so it's not colour-only, and the group has an
 * accessible label summarising who's here. Nothing to operate, so there's no keyboard/mouse
 * affordance to mirror — it's a live status indicator.
 */
export function PresenceAvatars({ peers, max = 4 }: { peers: PresencePeer[]; max?: number }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, max);
  const overflow = peers.length - shown.length;
  const names = peers.map((p) => p.label).join(", ");
  return (
    <div
      className="flex items-center -space-x-1"
      role="group"
      aria-label={`${peers.length} other ${peers.length === 1 ? "person" : "people"} here: ${names}`}
      data-testid="presence-avatars"
    >
      {shown.map((p) => (
        <span
          key={p.cid}
          title={p.label}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-card text-[10px] font-black text-white"
          style={{ backgroundColor: p.color }}
        >
          <span aria-hidden="true">{peerInitials(p.label)}</span>
          <span className="sr-only">{p.label}{p.editing ? ` (editing ${p.editing})` : ""}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-card bg-muted text-[10px] font-black text-muted-foreground"
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
