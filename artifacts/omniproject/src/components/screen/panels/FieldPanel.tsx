import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { FieldControl, type Decision } from "../../control/FieldControl";

/**
 * Field panel — renders a `field` bound to a `decision`, the runtime of the settings seam. The panel's
 * config carries the decision (its type + options + value); the field reads the TYPE and renders the
 * matching control. One or more decisions on the panel become a small settings group.
 * config: { decisions: { label, type, options?, value? }[] }  (or a single `decision`).
 */
function toDecision(raw: unknown): { label: string; decision: Decision } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o["type"];
  if (type !== "boolean" && type !== "single-choice" && type !== "multi-choice" && type !== "number" && type !== "text" && type !== "label") return null;
  return {
    label: String(o["label"] ?? ""),
    decision: {
      type,
      ...(Array.isArray(o["options"]) ? { options: (o["options"] as unknown[]).map(String) } : {}),
      ...(o["value"] != null ? { value: String(o["value"]) } : {}),
    },
  };
}

export function FieldPanel({ panel }: { panel: Panel }) {
  const raw = Array.isArray(panel.config?.["decisions"])
    ? (panel.config!["decisions"] as unknown[])
    : panel.config?.["decision"]
      ? [panel.config!["decision"]]
      : [];
  const items = raw.map(toDecision).filter((d): d is { label: string; decision: Decision } => d != null);

  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it, i) => <FieldRow key={i} label={it.label} decision={it.decision} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One decision rendered as a live field (local state — a real store binding is the next layer). */
function FieldRow({ label, decision }: { label: string; decision: Decision }) {
  const [value, setValue] = useState<string>(decision.value ?? "");
  return <FieldControl label={label} decision={decision} value={value} onChange={setValue} />;
}
