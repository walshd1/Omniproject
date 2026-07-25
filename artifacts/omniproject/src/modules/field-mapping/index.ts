/**
 * FIELD-MAPPING module — the live-superset field mapping picker (map a def's fields onto the union of
 * connected-backend + custom fields, resolve/save via the importer). Self-contained slice: page + its
 * data hook here, exposed through this barrel. The `defs/` folder holds this module's JSON definitions
 * (see defs/README.md).
 */
export { FieldMapping } from "./FieldMapping";
export * from "./field-mapping";
