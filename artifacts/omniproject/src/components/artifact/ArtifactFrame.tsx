import type { CSSProperties, ReactNode } from "react";
import { type StyleSpec, resolveStyle, hasStyle } from "../../lib/artifact-style";

/**
 * ArtifactFrame — the one place a StyleSpec is turned into pixels. Wrap any rendered artifact (a chart,
 * a report block, a table, a tile) in it and the user's title/font/text-colour/background apply
 * uniformly. Text colour is set on the frame so child SVG marks drawn with `currentColor` inherit it;
 * an explicit palette still wins for series fills. When the spec is empty the children render bare (no
 * extra wrapper), so unstyled artifacts are untouched.
 */
export function ArtifactFrame({ style, testId, className = "", children }: {
  style?: StyleSpec;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!hasStyle(style)) {
    return testId ? <div data-testid={testId}>{children}</div> : <>{children}</>;
  }

  const resolved = resolveStyle(style);
  const css: CSSProperties = {};
  if (resolved.fontFamily) css.fontFamily = resolved.fontFamily;
  if (resolved.color) css.color = resolved.color;
  if (resolved.background) css.background = resolved.background;

  const padded = Boolean(resolved.background);
  const centered = style.align === "center";

  return (
    <figure
      style={css}
      className={`space-y-2 ${padded ? "p-3 rounded-md" : ""} ${className}`.trim()}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {(style.title || style.subtitle) && (
        <figcaption className={centered ? "text-center" : ""}>
          {style.title && <div className="font-black text-sm leading-tight" data-testid={testId ? `${testId}-title` : undefined}>{style.title}</div>}
          {style.subtitle && <div className="text-xs opacity-70">{style.subtitle}</div>}
        </figcaption>
      )}
      {children}
    </figure>
  );
}
