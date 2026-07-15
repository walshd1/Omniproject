import type { Panel } from "../../../lib/screen";
import { WidgetView } from "../../dashboard/widgets";

/**
 * Widget panel — hosts any dashboard widget (from the widget catalogue) as a panel, the same bridge idea as
 * ViewPanel for methodology views. config: { type }. The widget components are self-contained (they read
 * their own data), so a screen can drop a portfolio-health / status-breakdown / capacity widget beside its
 * other panels with no plumbing. An unknown type degrades to WidgetView's own placeholder.
 */
export function WidgetPanel({ panel }: { panel: Panel }) {
  const type = String(panel.config?.["type"] ?? "");
  return (
    <div data-testid={`widget-panel-${type}`}>
      <WidgetView type={type} />
    </div>
  );
}
