import { STATUS_COLORS, PRIORITY_COLORS } from "../lib/constants";

/**
 * The small coloured status/priority dots used across the board and list views.
 * Centralised so the swatch sizing and the colour lookup live in one place.
 * `inline-block` keeps them sized whether or not the parent is a flex container.
 */
export function StatusDot({ status, className = "" }: { status: string; className?: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[status]} ${className}`.trim()} />;
}

export function PriorityDot({
  priority,
  title,
  className = "",
}: {
  priority: string;
  title?: string;
  className?: string;
}) {
  return <span className={`inline-block w-2 h-2 rounded-full ${PRIORITY_COLORS[priority]} ${className}`.trim()} title={title} />;
}
