/**
 * Primitive catalogue — RE-EXPORT SHIM. The shipped primitive definitions (data-only metadata) were relocated
 * into the shared `@workspace/backend-catalogue` (roadmap X.11: one source of truth the backend seeds into the
 * `system` def store and the SPA renders from). This shim keeps the historical import path
 * (`components/charts/catalogue`) working for the palette, builders and PrimitiveLibrary; the React RENDERERS
 * (ChartView etc.) stay here in the app. `chartType` is the `ChartViewSpec["type"]` a chart draws through — the
 * types are kept in lock-step by the shared `primitive-schema` contract (a drift test binds them).
 */
export {
  PRIMITIVE_CATALOGUE,
  primitiveCatalogue,
  getPrimitive,
  primitivesByCategory,
  chartPrimitives,
  type PrimitiveDef,
  type PrimitiveParam,
  type PrimitiveCategory,
  type PrimitiveParamType,
} from "@workspace/backend-catalogue";
