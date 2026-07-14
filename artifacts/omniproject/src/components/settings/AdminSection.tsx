import { type ComponentType, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The shared shell for an admin/settings panel: a `<section>` with an icon + uppercase heading, then a
 * bordered card body. Every *Admin panel hand-rolled the identical markup — the icon row
 * (`flex items-center gap-3 mb-4`), the `text-sm font-black uppercase tracking-widest text-muted-foreground`
 * heading, and the `bg-card border border-border p-4` card — differing only in icon, title, testId and
 * the body's spacing. This captures the shell; the panel supplies its controls as children. Pure/
 * presentational: no state, no data.
 */
export function AdminSection({ icon: Icon, title, testId, className, bodyClassName, children }: {
  /** A lucide (or any) icon component; rendered at `w-4 h-4 text-muted-foreground`. */
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** `data-testid` on the `<section>` (the panel's addressing hook). */
  testId?: string;
  /** Extra classes on the `<section>`. */
  className?: string;
  /** Body card spacing/extra classes (default `space-y-3`). */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section {...(testId ? { "data-testid": testId } : {})} {...(className ? { className } : {})}>
      <div className="flex items-center gap-3 mb-4">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">{title}</h2>
      </div>
      <div className={cn("bg-card border border-border p-4", bodyClassName ?? "space-y-3")}>
        {children}
      </div>
    </section>
  );
}
