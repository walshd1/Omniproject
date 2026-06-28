import { useAiContainment, CONTAINMENT_INFO } from "../lib/containment";

/**
 * The AI "leash" badge — shows how constrained autonomous AI behaviour is right now.
 * Drop it on every AI-tool surface so the containment level is always visible where AI
 * is used. Self-fetching + cheap; renders nothing until the level is known.
 */
export function ContainmentBadge({ surface }: { surface?: string }) {
  const { data } = useAiContainment(surface ?? (typeof window !== "undefined" ? window.location.pathname : undefined));
  const info = data ? CONTAINMENT_INFO[data.level] : undefined;
  if (!info) return null;
  return (
    <span
      data-testid="containment-badge"
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${info.cls}`}
      title={info.note}
    >
      {info.label}
    </span>
  );
}
