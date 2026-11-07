/**
 * Evaluator for the n8n expression dialect the backend catalogue's HTTP action
 * mappings are written in (`={{ expr }}`, with `$env.X` / `$json.body.payload.Y`
 * references and plain-JS bodies like `JSON.stringify({ … })`).
 *
 * Exists so `verify-backend` can execute a manifest's EXACT templates against a
 * live instance — certifying the strings the generated n8n workflow will run,
 * not a hand-written approximation of them.
 *
 * TRUST: templates come from the repo's own vendor catalogue (reviewed JSON, the
 * same trust level as source code) — they are evaluated with `new Function`, so
 * this must never be fed strings from network input or user-supplied files.
 */

export interface TemplateContext {
  $env: Record<string, string | undefined>;
  $json: { body: { payload: Record<string, unknown>; [k: string]: unknown } };
}

/** Evaluate one `{{ … }}` inner expression against the context. */
export function evalExpression(expr: string, ctx: TemplateContext): unknown {
  const fn = new Function("$env", "$json", `"use strict"; return (${expr});`) as (
    env: TemplateContext["$env"],
    json: TemplateContext["$json"],
  ) => unknown;
  return fn(ctx.$env, ctx.$json);
}

const SEGMENT = /\{\{([\s\S]*?)\}\}/g;

/**
 * Evaluate a catalogue template string:
 *  - `=`-prefixed marks an n8n expression string; the prefix is stripped.
 *  - If the whole (trimmed) string is a single `{{ … }}`, the expression's RAW
 *    value is returned (so a body template can yield an object/JSON string).
 *  - Otherwise every `{{ … }}` segment is evaluated and interpolated as text.
 *  - A string with no `{{ … }}` is returned as-is (minus any `=` prefix).
 */
export function evalTemplate(template: string, ctx: TemplateContext): unknown {
  const s = template.startsWith("=") ? template.slice(1) : template;
  const matches = [...s.matchAll(SEGMENT)];
  if (matches.length === 0) return s;
  const only = matches[0]!;
  if (matches.length === 1 && s.trim() === only[0]) {
    return evalExpression(only[1]!, ctx);
  }
  return s.replace(SEGMENT, (_m, expr: string) => String(evalExpression(expr, ctx)));
}

/** A permissive context for template-compilation checks: every `$env` name resolves
 *  (URL-ish names to a URL so `new URL()` passes), and the payload carries every
 *  field the catalogue's templates reference. */
export function stubContext(): TemplateContext {
  const env = new Proxy({} as Record<string, string>, {
    get: (_t, name: string) => (/URL|HOST|ENDPOINT|INSTANCE/i.test(name) ? "https://stub.invalid" : "stub-value"),
    has: () => true,
  });
  return {
    $env: env,
    $json: {
      body: {
        action: "list_projects",
        origin: "omniproject",
        idempotencyKey: "stub-idempotency-key",
        payload: new Proxy({} as Record<string, unknown>, {
          get: (_t, name: string) => (typeof name === "string" ? `stub-${name}` : "stub"),
          has: () => true,
        }),
      },
    },
  };
}
