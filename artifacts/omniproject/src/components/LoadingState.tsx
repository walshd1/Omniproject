/**
 * The brutalist "LOADING…" placeholder, shared across views and pages so the
 * markup (and its pulse animation) lives in exactly one place.
 *
 * `className` sets the layout wrapper (padding / centering); the typographic
 * treatment is fixed. Defaults match the common full-panel case.
 */
export function LoadingState({
  label = "LOADING…",
  className = "p-8 text-center",
}: {
  label?: string;
  className?: string | undefined;
}) {
  return (
    <div className={`${className} font-bold tracking-widest text-muted-foreground animate-pulse`.trim()}>
      {label}
    </div>
  );
}
