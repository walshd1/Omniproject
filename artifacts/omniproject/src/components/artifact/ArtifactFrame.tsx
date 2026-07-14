import type { CSSProperties, ReactNode } from "react";
import { type StyleSpec, resolveStyle, hasStyle } from "../../lib/artifact-style";
import { useScopedTheme, scopeStyle, hasScopedStyle } from "../../lib/theme-scope";
import type { ScopedOverride } from "../../lib/a11y-prefs";
import { ScopedThemeControl } from "../settings/ScopedThemeControl";

/**
 * ArtifactFrame — the one place a StyleSpec is turned into pixels. Wrap any rendered artifact (a chart,
 * a report block, a table, a tile) in it and the author's title/font/text-colour/background apply
 * uniformly. Text colour is set on the frame so child SVG marks drawn with `currentColor` inherit it.
 *
 * When a `scopeId` is supplied, the frame also becomes a per-user THEME SCOPE: it renders a small theme
 * control and applies the user's own per-artifact override ON TOP of the author StyleSpec (the user's
 * choice wins for their own view). Without a scopeId it stays a pure, hook-free presentational frame.
 */
export function ArtifactFrame({ style, testId, className = "", scopeId, scopeLabel, children }: {
  style?: StyleSpec | undefined;
  testId?: string | undefined;
  className?: string | undefined;
  /** Enables the per-user theme scope for this artifact (e.g. "artifact:report:<id>"). */
  scopeId?: string | undefined;
  /** Human label for the theme control (e.g. the report's name). */
  scopeLabel?: string | undefined;
  children: ReactNode;
}) {
  if (scopeId) {
    return (
      <ScopedArtifactFrame style={style} testId={testId} className={className} scopeId={scopeId} scopeLabel={scopeLabel ?? "this artifact"}>
        {children}
      </ScopedArtifactFrame>
    );
  }
  return <FrameInner style={style} testId={testId} className={className}>{children}</FrameInner>;
}

/** The scoped variant — reads the user's override for this artifact and supplies the theme control. */
function ScopedArtifactFrame({ style, testId, className, scopeId, scopeLabel, children }: {
  style?: StyleSpec | undefined; testId?: string | undefined; className: string; scopeId: string; scopeLabel: string; children: ReactNode;
}) {
  const { effective } = useScopedTheme(scopeId);
  return (
    <FrameInner style={style} testId={testId} className={className} scoped={effective} control={<ScopedThemeControl scopeId={scopeId} label={scopeLabel} />}>
      {children}
    </FrameInner>
  );
}

function FrameInner({ style, testId, className = "", scoped, control, children }: {
  style?: StyleSpec | undefined; testId?: string | undefined; className?: string | undefined; scoped?: ScopedOverride | null; control?: ReactNode; children: ReactNode;
}) {
  const resolved = resolveStyle(style);
  const css: CSSProperties = {};
  if (resolved.fontFamily) css.fontFamily = resolved.fontFamily;
  if (resolved.color) css.color = resolved.color;
  if (resolved.background) css.background = resolved.background;
  // The user's per-artifact override is layered ON TOP of the author StyleSpec, so it wins for them.
  Object.assign(css, scopeStyle(scoped));

  const styled = hasStyle(style) || hasScopedStyle(scoped);
  // Nothing to style and no control to show ⇒ render children bare (unstyled artifacts untouched).
  if (!styled && !control) {
    return testId ? <div data-testid={testId}>{children}</div> : <>{children}</>;
  }

  const padded = Boolean(resolved.background) || Boolean(scoped?.backgroundColor);
  const centered = style?.align === "center";

  return (
    <figure
      style={css}
      className={`space-y-2 ${padded ? "p-3 rounded-md" : ""} ${className}`.trim()}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {(style?.title || style?.subtitle || control) && (
        <figcaption className={`flex items-start justify-between gap-2 ${centered ? "text-center" : ""}`.trim()}>
          <div className={centered ? "flex-1 text-center" : ""}>
            {style?.title && <div className="font-black text-sm leading-tight" data-testid={testId ? `${testId}-title` : undefined}>{style.title}</div>}
            {style?.subtitle && <div className="text-xs opacity-70">{style.subtitle}</div>}
          </div>
          {control && <div className="shrink-0">{control}</div>}
        </figcaption>
      )}
      {children}
    </figure>
  );
}
