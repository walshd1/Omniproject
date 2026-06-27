/**
 * Vendor catalogue generator.
 *
 * Vendors are authored as one JSON file per vendor under
 * lib/backend-catalogue/vendors/<plane>/<id>.json — to add a vendor you design
 * the JSON against the plane's schema (vendors/schema/<plane>.schema.json) and
 * drop it in. This script validates every vendor file against its schema and
 * emits the embedded, type-checked TypeScript the catalogue imports
 * (lib/backend-catalogue/src/vendors.generated.ts), so the package stays
 * portable (no runtime fs / no JSON shipped) and a CI drift guard keeps the
 * generated module in lock-step with the JSON — the same pattern as gen-contract.
 *
 * Run: pnpm --filter @workspace/scripts run gen-vendors
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const VENDORS = path.join(ROOT, "lib/backend-catalogue/vendors");
const OUT_TS = path.join(ROOT, "lib/backend-catalogue/src/vendors.generated.ts");

type JsonSchema = Record<string, unknown>;

// ── Minimal dependency-free JSON-Schema validator ────────────────────────────
// Supports the subset the vendor schemas use: type, enum, required, properties,
// additionalProperties (boolean | schema), items, pattern. Returns error paths.
function validate(schema: JsonSchema, value: unknown, at = "$"): string[] {
  const errs: string[] = [];
  const type = schema["type"] as string | undefined;

  if (type && !typeMatches(type, value)) {
    errs.push(`${at}: expected ${type}, got ${jsTypeOf(value)}`);
    return errs; // type mismatch — deeper checks would be noise
  }
  if (schema["enum"] && !(schema["enum"] as unknown[]).includes(value)) {
    errs.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema["enum"])}`);
  }
  if (typeof value === "string" && schema["pattern"] && !new RegExp(schema["pattern"] as string).test(value)) {
    errs.push(`${at}: "${value}" does not match /${schema["pattern"]}/`);
  }

  if (type === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const props = (schema["properties"] as Record<string, JsonSchema>) ?? {};
    for (const req of (schema["required"] as string[]) ?? []) {
      if (!(req in obj)) errs.push(`${at}: missing required property "${req}"`);
    }
    const additional = schema["additionalProperties"];
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errs.push(...validate(props[k], v, `${at}.${k}`));
      else if (additional === false) errs.push(`${at}: unexpected property "${k}"`);
      else if (additional && typeof additional === "object") errs.push(...validate(additional as JsonSchema, v, `${at}.${k}`));
    }
  }
  if (type === "array" && Array.isArray(value) && schema["items"]) {
    value.forEach((v, i) => errs.push(...validate(schema["items"] as JsonSchema, v, `${at}[${i}]`)));
  }
  return errs;
}

/** Does a value satisfy a JSON-Schema `type` keyword? */
function typeMatches(type: string, v: unknown): boolean {
  switch (type) {
    case "object": return !!v && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "number": return typeof v === "number";
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    default: return true;
  }
}

/** A readable JS type label for error messages. */
function jsTypeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ── Planes ───────────────────────────────────────────────────────────────────
interface Plane {
  dir: string;
  schema: string;
  constName: string;
  typeName: string;
  typeModule: string;
}

const PLANES: Plane[] = [
  { dir: "backends", schema: "backend.schema.json", constName: "BACKENDS_DATA", typeName: "BackendDefinition", typeModule: "./backend-catalogue" },
  { dir: "brokers", schema: "broker.schema.json", constName: "BROKERS_DATA", typeName: "BrokerDefinition", typeModule: "./broker-catalogue" },
  { dir: "notifications", schema: "notification.schema.json", constName: "NOTIFICATIONS_DATA", typeName: "NotificationDefinition", typeModule: "./notification-catalogue" },
  { dir: "outputs", schema: "output.schema.json", constName: "OUTPUTS_DATA", typeName: "OutputDefinition", typeModule: "./output-catalogue" },
];

/** Read, validate and id-sort one plane's vendor files. Throws on any violation. */
function loadPlane(plane: Plane): Array<{ id: string }> {
  const schema = JSON.parse(fs.readFileSync(path.join(VENDORS, "schema", plane.schema), "utf8")) as JsonSchema;
  const dir = path.join(VENDORS, plane.dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const rows: Array<{ id: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const full = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(full, "utf8")) as { id?: string };
    const errs = validate(schema, data);
    if (errs.length) throw new Error(`${plane.dir}/${file} fails ${plane.schema}:\n  - ${errs.join("\n  - ")}`);
    if (data.id !== file.replace(/\.json$/, "")) throw new Error(`${plane.dir}/${file}: filename must equal id "${data.id}"`);
    if (seen.has(data.id)) throw new Error(`${plane.dir}: duplicate id "${data.id}"`);
    seen.add(data.id);
    rows.push(data as { id: string });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

// ── Emit ─────────────────────────────────────────────────────────────────────
const loaded = PLANES.map((plane) => ({ plane, rows: loadPlane(plane) }));

const lines: string[] = [
  "/* GENERATED by scripts/src/gen-vendors.ts — do not edit.",
  "   Vendors are authored as JSON under lib/backend-catalogue/vendors/<plane>/;",
  "   run `pnpm --filter @workspace/scripts run gen-vendors` to regenerate. */",
];
for (const { plane } of loaded) {
  lines.push(`import type { ${plane.typeName} } from "${plane.typeModule}";`);
}
lines.push("");
for (const { plane, rows } of loaded) {
  lines.push(`export const ${plane.constName}: ${plane.typeName}[] = ${JSON.stringify(rows, null, 2)};`);
  lines.push("");
}
fs.writeFileSync(OUT_TS, lines.join("\n"));

// ── Report ────────────────────────────────────────────────────────────────────
for (const { plane, rows } of loaded) console.log(`${plane.dir}: ${rows.length} vendors validated`);
console.log(`  → ${path.relative(ROOT, OUT_TS)}`);
