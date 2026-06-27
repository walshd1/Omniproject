import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

interface ListItem { title: string; subtitle?: string }

/**
 * List panel — a vertical list of items (e.g. an activity feed or "my work").
 * config: { items: { title, subtitle? }[] }.
 */
export function ListPanel({ panel }: { panel: Panel }) {
  const raw = Array.isArray(panel.config?.["items"]) ? (panel.config!["items"] as unknown[]) : [];
  const items: ListItem[] = raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => ({ title: String(i["title"] ?? ""), subtitle: typeof i["subtitle"] === "string" ? i["subtitle"] : undefined }));
  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to show.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item, i) => (
              <li key={i} className="py-1.5">
                <div className="text-sm font-medium text-foreground">{item.title}</div>
                {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
