import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Text panel — static prose/guidance. config: { text }. Plain text (no HTML) so a
 * config-supplied string can never inject markup.
 */
export function TextPanel({ panel }: { panel: Panel }) {
  const text = typeof panel.config?.["text"] === "string" ? (panel.config["text"] as string) : "";
  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <p className="whitespace-pre-line text-sm text-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
