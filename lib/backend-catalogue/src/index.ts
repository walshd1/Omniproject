/**
 * @workspace/backend-catalogue — the shared source of truth for OmniProject's
 * three integration planes, each modelled the same way (neutral manifest +
 * capabilities kept SEPARATE from its concrete tools, linked into one definition):
 *
 *   - BACKENDS — systems of record (./backend-manifest + ./backend-catalogue), with
 *     the n8n binding + workflow generator (./n8n-generator).
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
export * from "./n8n-generator";
export * from "./broker-catalogue";
export * from "./output-catalogue";
export * from "./notification-catalogue";
export * from "./planes";
export * from "./methodology-catalogue";
export * from "./methodology-rulesets";
export * from "./report-catalogue";
export * from "./screen-catalogue";
export * from "./plane-verifier";
export * from "./vendor-schema";
export * from "./vendor-overlay";
export * from "./view-catalogue";
export * from "./compatibility";
export * from "./notification-routing";
export * from "./notification-kinds";
export * from "./field-vocabulary";
