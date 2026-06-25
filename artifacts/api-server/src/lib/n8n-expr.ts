/**
 * Minimal resolver for the n8n expressions used in backend manifest URLs, so we
 * can *certify* a mapping offline: resolve a manifest's templates against a
 * sample env + payload and assert the concrete request matches the backend's
 * real API (method / URL). It handles the two constructs manifest URLs use —
 * `{{ $env.NAME }}` and `{{ $json.body.payload.path }}` — and strips the leading
 * `=` n8n uses to mark an expression. JS-expression bodies (JSON.stringify(...))
 * are intentionally NOT evaluated; the certification asserts their presence, not
 * their runtime value.
 */

export interface ExprContext {
  env?: Record<string, string>;
  payload?: Record<string, unknown>;
}

// Walks a dotted path over a plain object. No prototype-key guard is needed: this
// runs ONLY during offline certification against sample payloads (read-only, never
// on live request data), so it is not a security boundary.
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function resolveExpr(expr: string, ctx: ExprContext): unknown {
  const env = expr.match(/^\$env\.([A-Za-z0-9_]+)$/);
  if (env) return ctx.env?.[env[1]];
  const payload = expr.match(/^\$json\.body\.payload\.(.+)$/);
  if (payload) return getPath(ctx.payload, payload[1]);
  return undefined;
}

/** Resolve a manifest URL/header template. Unresolved `{{…}}` (e.g. JS) → "". */
export function resolveTemplate(template: string, ctx: ExprContext): string {
  const body = template.startsWith("=") ? template.slice(1) : template;
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const value = resolveExpr(expr.trim(), ctx);
    return value === undefined ? "" : String(value);
  });
}

/** True when no `{{…}}` placeholders remain (the template fully resolved). */
export function isFullyResolved(template: string, ctx: ExprContext): boolean {
  return !/\{\{[^}]+\}\}/.test(resolveTemplate(template, ctx));
}
