/**
 * @workspace/backend-catalogue — the single, shared source of truth for which
 * project/work backends OmniProject knows how to broker, and how to generate an
 * importable n8n workflow for each.
 *
 * Referenced by BOTH the gateway (routes/setup.ts surfaces the catalogue +
 * generates workflows) AND the setup wizard (@workspace/scripts), so the two can
 * never drift. Pure data + pure functions, zero runtime dependencies.
 */
export * from "./backend-manifest";
export * from "./n8n-backends";
export * from "./n8n-generator";
