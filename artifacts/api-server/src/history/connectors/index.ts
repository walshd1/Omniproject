/**
 * Retention connectors — pluggable `RetentionSource` implementations for the common cloud stores, each
 * pure logic over an injected client port (no cloud SDK above the seam). The operator's broker/boot
 * layer supplies the SDK-backed port and registers the source via `registerRetentionProvider`.
 * See docs/RETENTION-CONNECTORS.md.
 */
export * from "./object-store";
export * from "./table-store";
export * from "./warehouse";
