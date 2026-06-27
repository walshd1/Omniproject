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

/** A Prometheus histogram (cumulative buckets + sum + count). Buckets must be
 *  ascending by `le`; the renderer appends the implicit `+Inf` bucket. */
export interface HistogramMetric {
  name: string;
  help: string;
  type: "histogram";
  buckets: { le: number; count: number }[];
  sum: number;
  count: number;
  labels?: Record<string, string>;
}

export type AnyMetric = Metric | HistogramMetric;

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function renderLabels(labels?: Record<string, string>): string {
  if (!labels) return "";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`).join(",")}}`;
}

function mergeLabels(base: Record<string, string> | undefined, extra: Record<string, string>): Record<string, string> {
  return base ? { ...base, ...extra } : extra;
}

export function formatPrometheus(metrics: AnyMetric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    if (m.type === "histogram") {
      for (const b of m.buckets) {
        lines.push(`${m.name}_bucket${renderLabels(mergeLabels(m.labels, { le: String(b.le) }))} ${b.count}`);
      }
      lines.push(`${m.name}_bucket${renderLabels(mergeLabels(m.labels, { le: "+Inf" }))} ${m.count}`);
      lines.push(`${m.name}_sum${renderLabels(m.labels)} ${m.sum}`);
      lines.push(`${m.name}_count${renderLabels(m.labels)} ${m.count}`);
    } else {
      for (const s of m.samples) {
        lines.push(`${m.name}${renderLabels(s.labels)} ${s.value}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}
