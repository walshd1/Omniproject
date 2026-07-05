export interface StatusMeta {
  label: string;
  cls: string;
  title: string;
}

/**
 * Shared rendering shell for a small labelled status pill (uppercase, bordered,
 * tooltip-carrying) — the shape `ProvenanceBadge` and `VerificationBadge` both
 * need. Callers own their own vocabulary/meta map and value-resolution logic;
 * this only renders it, falling back to `fallback` for a missing/unrecognised
 * value rather than crashing on an undefined `meta` entry.
 */
export function StatusBadge<T extends string>({
  value,
  meta,
  fallback,
  className = "",
}: {
  value?: T | undefined;
  meta: Record<T, StatusMeta>;
  fallback: T;
  className?: string;
}) {
  const m = meta[value as T] ?? meta[fallback];
  return (
    <span
      title={m.title}
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${m.cls} ${className}`}
    >
      {m.label}
    </span>
  );
}
