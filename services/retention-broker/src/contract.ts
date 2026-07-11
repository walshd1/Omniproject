/**
 * The retention contract, re-exported from the gateway's PURE history algebra so the broker and the
 * gateway share ONE source of truth for the port interfaces + the key/query layout (a broker that laid
 * out S3 keys differently from what the gateway's connector expects would silently corrupt reads).
 * Only pure, SDK-free modules are imported here — the SDK lives solely in this service's `ports/`.
 */
export type { ObjectStorePort } from "../../../artifacts/api-server/src/history/connectors/object-store";
export { objectStoreRetentionSource } from "../../../artifacts/api-server/src/history/connectors/object-store";
export type { TableStorePort, TableItem, SkQuery } from "../../../artifacts/api-server/src/history/connectors/table-store";
export { tableStoreRetentionSource } from "../../../artifacts/api-server/src/history/connectors/table-store";
export type { WarehousePort, WarehouseQuery } from "../../../artifacts/api-server/src/history/connectors/warehouse";
export { warehouseRetentionSource } from "../../../artifacts/api-server/src/history/connectors/warehouse";
export type { RetentionSource } from "../../../artifacts/api-server/src/history/retention";
export type { EntitySnapshot, HistoryEntry, TimeWindow, Provenance } from "../../../artifacts/api-server/src/history/types";
