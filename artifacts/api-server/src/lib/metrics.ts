/**
 * Prometheus exposition (text format 0.0.4) — so Grafana (via Prometheus) can
 * scrape OmniProject portfolio metrics. Pure formatter, unit-tested; collection
 * lives in the route. Stateless: metrics are computed on request, nothing stored.
 */

export interface Sample {
  value: number;
  labels?: Record<string, string>;
}

export interface Metric {
  name: string;
  help: string;
  type: "gauge" | "counter";
  samples: Sample[];
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function renderLabels(labels?: Record<string, string>): string {
  if (!labels) return "";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`).join(",")}}`;
}

export function formatPrometheus(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    for (const s of m.samples) {
      lines.push(`${m.name}${renderLabels(s.labels)} ${s.value}`);
    }
  }
  return lines.join("\n") + "\n";
}
