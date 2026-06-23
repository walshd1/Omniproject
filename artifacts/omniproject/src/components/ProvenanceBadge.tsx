export type Provenance = "sourced" | "derived" | "sample";

const META: Record<Provenance, { label: string; cls: string; title: string }> = {
  sourced: {
    label: "LIVE · BACKEND",
    cls: "border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/10",
    title: "Read from the backend system of record via n8n.",
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
  provenance?: Provenance;
  mode?: string;
  className?: string;
}) {
  const resolved: Provenance = provenance ?? (mode === "demo" || !mode ? "sample" : "sourced");
  const m = META[resolved];
  return (
    <span
      title={m.title}
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${m.cls} ${className}`}
    >
      {m.label}
    </span>
  );
}
