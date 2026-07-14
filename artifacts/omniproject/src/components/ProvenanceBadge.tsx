import { StatusBadge, type StatusMeta } from "./StatusBadge";

export type Provenance = "sourced" | "derived" | "sample" | "captured" | "generated";

const META: Record<Provenance, StatusMeta> = {
  sourced: {
    label: "LIVE · BACKEND",
    cls: "border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/10",
    title: "Read from the backend system of record via the broker.",
  },
  derived: {
    label: "DERIVED",
    cls: "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10",
    title: "Computed by OmniProject from real issue data — not a figure recorded by the backend.",
  },
  sample: {
    label: "SAMPLE DATA",
    cls: "border-border text-muted-foreground bg-muted/40",
    title: "Demo/placeholder data — no backend is wired. Not a real figure.",
  },
  captured: {
    label: "CAPTURED · SNAPSHOTS",
    cls: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10",
    title: "Trend built from point-in-time snapshots you captured in the browser — not backend-recorded history.",
  },
  // AI-authored narrative / estimate. A DISTINCT lane (violet) so a generated line is never
  // read as a backend fact or even an OmniProject-computed figure — it is a model's prose over
  // the real numbers, and must be verified before it is relied on. (AA-contrast shade: 700/400.)
  generated: {
    label: "AI · GENERATED",
    cls: "border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/10",
    title: "Written by an AI model from real figures — a narrative or estimate, not a backend-recorded fact. Verify before relying on it.",
  },
};

/**
 * Honesty signal so a synthesised number is never shown as fact. Resolves the
 * provenance from an explicit value, falling back to the capabilities `mode`
 * ("demo" ⇒ sample, otherwise sourced).
 */
export function ProvenanceBadge({
  provenance,
  mode,
  className = "",
}: {
  provenance?: Provenance | undefined;
  mode?: string | undefined;
  className?: string | undefined;
}) {
  const resolved: Provenance = provenance ?? (mode === "demo" || !mode ? "sample" : "sourced");
  // Defensive: the logging server can emit provenance values outside this badge's
  // vocabulary (e.g. "replayed", "projected"); StatusBadge falls back to "sourced"
  // rather than crashing on an undefined META entry.
  return <StatusBadge value={resolved} meta={META} fallback="sourced" className={className} />;
}
