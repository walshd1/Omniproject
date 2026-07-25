import { useWorkVocabulary } from "../lib/work-vocabulary";

/**
 * The small coloured status/priority dots used across the board and list views.
 * Centralised so the swatch sizing and the colour lookup live in one place. Colours + labels come from the
 * resolved work-vocabulary (org/scope/i18n/accessibility folded) — the swatch is the token's hex colour via
 * inline style (so a custom status can carry any colour), the tooltip its localised label. Unknown
 * (backend-agnostic) values fall back to a neutral swatch.
 */
export function StatusDot({ status, className = "" }: { status: string; className?: string }) {
  const { statusColor, statusLabel } = useWorkVocabulary();
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${className}`.trim()}
      style={{ backgroundColor: statusColor(status) }}
      title={statusLabel(status)}
    />
  );
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
  const { priorityColor, priorityLabel } = useWorkVocabulary();
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${className}`.trim()}
      style={{ backgroundColor: priorityColor(priority) }}
      title={title ?? priorityLabel(priority)}
    />
  );
}
