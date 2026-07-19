/**
 * @workspace/backend-catalogue — the shared source of truth for OmniProject's
 * three integration planes, each modelled the same way (neutral manifest +
 * capabilities kept SEPARATE from its concrete tools, linked into one definition):
 *
 *   - BACKENDS — systems of record (./backend-manifest + ./backend-catalogue), with
 *     the n8n binding + workflow generator (./workflow-generator).
 *   - BROKERS  — the automation/translation layer (./broker-catalogue).
 *   - OUTPUTS  — the outward interfaces: MCP, OData, BI, metrics, exports, events
 *     (./output-catalogue).
 *   - NOTIFICATIONS — the channels alerts are delivered TO: Slack, Teams, email,
 *     incident tools (./notification-catalogue).
 *
 * Referenced by BOTH the gateway and the setup wizard, so they can never drift.
 * Pure data + pure functions, zero runtime dependencies.
 */
export * from "./backend-manifest";
export * from "./backend-catalogue";
export * from "./key-format";
export * from "./workflow-generator";
export * from "./broker-catalogue";
export * from "./output-catalogue";
export * from "./notification-catalogue";
export * from "./planes";
export * from "./methodology-catalogue";
export * from "./persona-catalogue";
export * from "./methodology-rulesets";
export * from "./drill-to";
export * from "./def-compose";
export * from "./def-constraints";
export * from "./field-primitive-catalogue";
export * from "./container-constraints";
export * from "./def-refs";
export * from "./report-catalogue";
export * from "./num";
export * from "./priority-weights";
export * from "./currency";
export * from "./consolidation";
export * from "./mapping-catalogue";
export * from "./form-catalogue";
export * from "./automation-catalogue";
export * from "./template-catalogue";
export * from "./wiki-catalogue";
export * from "./canvas-catalogue";
export * from "./proof-catalogue";
export * from "./goal-catalogue";
export * from "./invoice-catalogue";
export * from "./marketplace-catalogue";
export * from "./registry-catalogue";
export * from "./primitive-schema";
export * from "./primitive-catalogue";
export * from "./widget-catalogue";
export * from "./component-library";
export * from "./screen-catalogue";
export * from "./screen-def-catalogue";
export * from "./plane-verifier";
export * from "./vendor-schema";
export * from "./vendor-overlay";
export * from "./view-catalogue";
export * from "./compatibility";
export * from "./notification-routing";
export * from "./notification-kinds";
export * from "./field-vocabulary";
export * from "./methodology-pack";
export * from "./entity-resolution";
export * from "./dashboard-preset-catalogue";
export * from "./rollup";
export * from "./methodology-group";
export * from "./composition";
