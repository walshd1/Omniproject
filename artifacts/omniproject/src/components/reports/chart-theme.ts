/**
 * Shared Recharts theming. Recharts identifies axis / grid / tooltip children by their component
 * TYPE, so they can't be wrapped in our own components (the chart wouldn't recognise them) — the
 * way to centralise their look is shared prop objects spread onto the real primitives. A palette
 * or token change becomes a one-line edit here instead of the same tweak across every chart.
 *
 *   <CartesianGrid {...gridTheme} />
 *   <XAxis dataKey="date" {...axisTheme} fontSize={10} />
 *   <YAxis {...axisTheme} fontSize={11} allowDecimals={false} />
 *   <Tooltip contentStyle={chartTooltipStyle} />
 */

/** CartesianGrid theming — dashed, drawn in the border token colour. */
export const gridTheme = { strokeDasharray: "3 3", stroke: "currentColor", className: "text-border" } as const;

/** XAxis / YAxis theming — muted-foreground stroke via currentColor. Callers add dataKey/fontSize. */
export const axisTheme = { stroke: "currentColor", className: "text-muted-foreground" } as const;

/** Tooltip `contentStyle` — card background + border token, matching the surrounding panel. */
export const chartTooltipStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" } as const;
