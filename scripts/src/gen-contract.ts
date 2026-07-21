/**
 * Broker-contract generator.
 *
 * Reads the canonical TypeScript declarations that DEFINE the broker contract
 * (artifacts/api-server/src/broker/{types,contract}.ts) and emits the published
 * contract artefacts:
 *
 *   docs/contract/broker.v1.schema.json   — JSON Schema (draft 2020-12)
 *   docs/CONTRACT.md                      — human-readable, generated
 *
 * Both are checked into the repo and regenerated in CI; a drift guard fails the
 * build if the committed copies don't match what the types produce, so the docs
 * can never lie about the code. Output is deterministic (no timestamps) so the
 * diff is empty unless a type actually changed.
 *
 * The converter handles the deliberately small type vocabulary the contract
 * uses (string/number/boolean, string-literal unions, arrays, Record<>, Date,
 * optional `?`, `| null`, nested object literals, `extends Row`, and references
 * to other contract types). Anything it can't map is FLAGGED in the output
 * rather than silently dropped — see `flags` below.
 *
 * Run: pnpm --filter @workspace/scripts run gen-contract
 */
import * as ts from "./lib/ts-ast";
import { parseSourceFile } from "./lib/ts-ast";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT as ROOT } from "./lib/repo-root";
import { escapeTableCell } from "./lib/markdown";
import { parseSourceFile } from "./lib/ts-ast";

const SRC_DIR = path.join(ROOT, "artifacts/api-server/src");
const OUT_SCHEMA = path.join(ROOT, "docs/contract/broker.v1.schema.json");
const OUT_MD = path.join(ROOT, "docs/CONTRACT.md");
// Embedded copy the gateway imports, so GET /api/contract serves the schema with
// no runtime dependency on the docs/ tree being shipped. Regenerated in lock-step.
const OUT_TS = path.join(ROOT, "artifacts/api-server/src/broker/contract.schema.generated.ts");

const CONTRACT_VERSION = "v1";

type JsonSchema = Record<string, unknown>;

/** Collected as we walk: enum arrays, type defs, the Broker method list, flags. */
const enumArrays = new Map<string, string[]>(); // `const X = [...] as const`
const constStrings = new Map<string, string>(); // `const X = "lit" as const`
const defs = new Map<string, JsonSchema>();
const referenced = new Set<string>();
const flags: string[] = [];
/** Type-parameter names in scope for the declaration currently being converted. */
let typeParams = new Set<string>();

interface MethodSig {
  name: string;
  optional: boolean;
  params: { name: string; type: string }[];
  returns: string;
  doc: string;
}
const brokerMethods: MethodSig[] = [];

function read(rel: string): ts.SourceFile {
  return parseSourceFile(path.join(SRC_DIR, rel));
}

function jsdoc(node: ts.Node): string {
  // TS7 exposes the parsed JSDoc blocks directly on the node (`node.jsDoc`); each block's
  // `comment` is a node array whose text is recovered via `getTextOfJSDocComment`.
  for (const doc of node.jsDoc ?? []) {
    const text = ts.getTextOfJSDocComment((doc as ts.JSDoc).comment);
    if (text) return text.replace(/\s+/g, " ").trim();
  }
  return "";
}

/** Convert a syntactic type node into JSON Schema. Records references + flags. */
function convert(node: ts.TypeNode, ctx: string): JsonSchema {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { type: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: "boolean" };
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.AnyKeyword:
      return {};
    case ts.SyntaxKind.NullKeyword:
      return { type: "null" };
  }

  if (ts.isParenthesizedTypeNode(node)) return convert(node.type, ctx);

  // `typeof CONST` where CONST is a `const X = "lit" as const` → that literal.
  if (ts.isTypeQueryNode(node)) {
    const v = constStrings.get(node.exprName.getText());
    if (v !== undefined) return { const: v };
  }

  // `(typeof ARR)[number]` → enum from the collected const array.
  if (ts.isIndexedAccessTypeNode(node)) {
    let obj: ts.TypeNode = node.objectType;
    if (ts.isParenthesizedTypeNode(obj)) obj = obj.type;
    if (ts.isTypeQueryNode(obj)) {
      const values = enumArrays.get(obj.exprName.getText());
      if (values) return { enum: values };
    }
  }

  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal)) return { const: node.literal.text };
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
    if (ts.isNumericLiteral(node.literal)) return { const: Number(node.literal.text) };
    return {};
  }

  if (ts.isArrayTypeNode(node)) {
    return { type: "array", items: convert(node.elementType, ctx) };
  }

  if (ts.isTypeLiteralNode(node)) {
    return objectFromMembers(node.members, ctx, false);
  }

  if (ts.isUnionTypeNode(node)) {
    const parts = node.types;
    const isNull = (p: ts.TypeNode) => (ts.isLiteralTypeNode(p) && p.literal.kind === ts.SyntaxKind.NullKeyword) || p.kind === ts.SyntaxKind.NullKeyword;
    // `undefined` in an optional property's union (under exactOptionalPropertyTypes) is TS
    // bookkeeping, not a wire-format difference — strip it so `T | undefined` ≡ `T`.
    const isUndefined = (p: ts.TypeNode) => p.kind === ts.SyntaxKind.UndefinedKeyword;
    const nonNull = parts.filter((p) => !isNull(p) && !isUndefined(p));
    const nullable = parts.some(isNull);
    // A bare `T | undefined` produces exactly the schema for `T` (no anyOf wrapper, no drift).
    if (nonNull.length === 1 && !nullable) return convert(nonNull[0]!, ctx);
    // All string literals → enum.
    if (nonNull.every((p) => ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal))) {
      const values = nonNull.map((p) => ((p as ts.LiteralTypeNode).literal as ts.StringLiteral).text);
      const schema: JsonSchema = { enum: nullable ? [...values, null] : values };
      return schema;
    }
    // string | Date | null and similar — collapse Date→string, dedupe base types.
    const mapped = nonNull.map((p) => convert(p, ctx));
    const types = new Set<string>();
    for (const m of mapped) if (typeof m["type"] === "string") types.add(m["type"] as string);
    if (mapped.every((m) => typeof m["type"] === "string") && types.size === 1) {
      const t = [...types][0]!;
      return { type: nullable ? [t, "null"] : t };
    }
    // Heterogeneous union → anyOf, threading nullability.
    const anyOf = mapped;
    if (nullable) anyOf.push({ type: "null" });
    return { anyOf };
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    // A generic type parameter (e.g. `T` in BrokerEnvelope<T>) → permissive any.
    if (typeParams.has(name)) return {};
    const args = node.typeArguments ?? [];
    if (name === "Array" && args[0]) return { type: "array", items: convert(args[0], ctx) };
    if (name === "Record") {
      return { type: "object", additionalProperties: args[1] ? convert(args[1], ctx) : true };
    }
    if (name === "Date") return { type: "string", format: "date-time" };
    if (name === "Row") {
      referenced.add("Row");
      return { $ref: "#/$defs/Row" };
    }
    // A reference to another named contract type.
    referenced.add(name);
    return { $ref: `#/$defs/${name}` };
  }

  flags.push(`${ctx}: unhandled type node \`${node.getText()}\` (kind ${ts.SyntaxKind[node.kind]}) — mapped to permissive {}.`);
  return {};
}

function objectFromMembers(members: ts.NodeArray<ts.TypeElement>, ctx: string, additional: boolean): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const m of members) {
    if (!ts.isPropertySignatureDeclaration(m) || !m.type || !m.name) continue;
    const key = m.name.getText().replace(/^["']|["']$/g, "");
    properties[key] = convert(m.type, `${ctx}.${key}`);
    const doc = jsdoc(m);
    if (doc) properties[key]!["description"] = doc;
    if (m.postfixToken?.kind !== ts.SyntaxKind.QuestionToken) required.push(key);
  }
  const schema: JsonSchema = { type: "object", properties };
  if (required.length) schema["required"] = required;
  schema["additionalProperties"] = additional;
  return schema;
}

function handleInterface(node: ts.InterfaceDeclaration): void {
  const name = node.name.text;
  typeParams = new Set((node.typeParameters ?? []).map((p) => p.name.text));
  // `extends Row` (Record<string, unknown>) → open object.
  let additional = false;
  if (node.heritageClauses) {
    for (const h of node.heritageClauses) {
      for (const t of h.types) {
        if (t.expression.getText() === "Row") additional = true;
      }
    }
  }
  const schema = objectFromMembers(node.members, name, additional);
  const doc = jsdoc(node);
  if (doc) schema["description"] = doc;
  defs.set(name, schema);
}

function handleTypeAlias(node: ts.TypeAliasDeclaration): void {
  const name = node.name.text;
  typeParams = new Set((node.typeParameters ?? []).map((p) => p.name.text));
  // All supported forms (unions, Record, typeof-const, indexed-access enums)
  // go through convert().
  const schema = convert(node.type, name);
  const doc = jsdoc(node);
  if (doc) schema["description"] = doc;
  defs.set(name, schema);
}

/** Collect `const NAME = [ "a", "b" ] as const` arrays for enum resolution. */
function collectConstArrays(sf: ts.SourceFile): void {
  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      let init: ts.Expression = decl.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      if (ts.isStringLiteral(init)) {
        constStrings.set(decl.name.text, init.text);
        continue;
      }
      if (!ts.isArrayLiteralExpression(init)) continue;
      const values: string[] = [];
      for (const el of init.elements) if (ts.isStringLiteral(el)) values.push(el.text);
      if (values.length) enumArrays.set(decl.name.text, values);
    }
  });
}

function collectBrokerMethods(node: ts.InterfaceDeclaration): void {
  for (const m of node.members) {
    if (!ts.isMethodSignatureDeclaration(m) || !m.name) continue;
    brokerMethods.push({
      name: m.name.getText(),
      optional: m.postfixToken?.kind === ts.SyntaxKind.QuestionToken,
      params: m.parameters
        .filter((p) => p.name.getText() !== "ctx")
        .map((p) => ({ name: p.name.getText(), type: p.type ? p.type.getText().replace(/\s+/g, " ") : "unknown" })),
      returns: m.type ? m.type.getText().replace(/\s+/g, " ") : "unknown",
      doc: jsdoc(m),
    });
  }
}

// ── Walk the canonical files ─────────────────────────────────────────────────
// The broker contract lives in broker/{types,contract}.ts. A few types the contract
// references are defined among internal lib/ modules — or in the shared
// @workspace/backend-catalogue package (canvas / proof / wiki entities that broker/types.ts
// imports rather than re-declaring, to keep ONE source of truth shared with the SPA). We pull
// in ONLY those named types so the contract is self-contained (no dangling $refs) without
// dragging in the rest of those files:
//   - EnumeratedField — the describeFields() return shape (lib/field-registry.ts).
//   - Scope + ScopeLevel — the forwarded data-scope on ActorContext (lib/scope.ts).
//   - SessionBind — the per-session signing binding on ActorContext (lib/session-key.ts).
//   - CanvasElement (+ its element-type / colour / shape unions) — the whiteboard scene element
//     (backend-catalogue/canvas-catalogue.ts), referenced by WhiteboardScene.elements.
//   - Deliverable, Annotation, ProofDecision (+ their kind/type unions) — the proof entities
//     (backend-catalogue/proof-catalogue.ts), referenced by Proof/ProofWrite/ProofMeta.
//   - DocBlock (+ DocBlockType / CalloutTone / DocListItem) — the wiki document block
//     (backend-catalogue/wiki-catalogue.ts), referenced by the doc entities.
// Each imported name must bring its own referenced sub-types, or those would dangle in turn.
const BC = "../../../lib/backend-catalogue/src";
const SOURCES: { file: string; only?: Set<string> }[] = [
  { file: "broker/types.ts" },
  { file: "broker/contract.ts" },
  { file: "lib/field-registry.ts", only: new Set(["EnumeratedField"]) },
  { file: "lib/scope.ts", only: new Set(["Scope", "ScopeLevel"]) },
  { file: "lib/session-key.ts", only: new Set(["SessionBind"]) },
  { file: `${BC}/canvas-catalogue.ts`, only: new Set(["CanvasElement", "CanvasElementType", "StickyColor", "ShapeKind"]) },
  { file: `${BC}/proof-catalogue.ts`, only: new Set(["Deliverable", "DeliverableKind", "Annotation", "AnnotationType", "ProofDecision"]) },
  { file: `${BC}/wiki-catalogue.ts`, only: new Set(["DocBlock", "DocBlockType", "CalloutTone", "DocListItem"]) },
];

for (const { file } of SOURCES) collectConstArrays(read(file));

for (const { file, only } of SOURCES) {
  read(file).forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) {
      if (only && !only.has(node.name.text)) return;
      if (node.name.text === "Broker") collectBrokerMethods(node);
      else handleInterface(node);
    } else if (ts.isTypeAliasDeclaration(node)) {
      if (only && !only.has(node.name.text)) return;
      handleTypeAlias(node);
    }
  });
}

// Row is referenced but defined as a bare `type Row = Record<string, unknown>`;
// ensure a $def exists as an open object.
if (!defs.has("Row")) defs.set("Row", { type: "object", additionalProperties: true, description: "Loosely-typed normalised row." });

// Flag any referenced-but-undefined type (a contract field with no type in code).
for (const ref of referenced) {
  if (!defs.has(ref)) flags.push(`Type \`${ref}\` is referenced by the contract but has no definition in broker/{types,contract}.ts.`);
}

// ── Emit JSON Schema ─────────────────────────────────────────────────────────
const sortedDefs: Record<string, JsonSchema> = {};
for (const name of [...defs.keys()].sort()) sortedDefs[name] = defs.get(name)!;

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://omniproject.dev/contract/broker.${CONTRACT_VERSION}.schema.json`,
  title: "OmniProject Broker Contract",
  description:
    "The published, versioned interface between OmniProject and any broker. Generated from " +
    "artifacts/api-server/src/broker/{types,contract}.ts — do not edit by hand.",
  "x-contract-version": CONTRACT_VERSION,
  $defs: sortedDefs,
};

fs.mkdirSync(path.dirname(OUT_SCHEMA), { recursive: true });
fs.writeFileSync(OUT_SCHEMA, JSON.stringify(schema, null, 2) + "\n");

// ── Emit the embedded TS module the gateway serves ───────────────────────────
const tsBody = [
  "/* GENERATED by scripts/src/gen-contract.ts — do not edit. */",
  "/* The published broker contract, embedded so GET /api/contract has no runtime",
  "   dependency on the docs/ tree. Regenerated in lock-step with the JSON + MD. */",
  `export const BROKER_CONTRACT_SCHEMA = ${JSON.stringify(schema, null, 2)} as const;`,
  "",
].join("\n");
fs.writeFileSync(OUT_TS, tsBody);

// ── Emit CONTRACT.md ─────────────────────────────────────────────────────────
function fieldRows(s: JsonSchema): string {
  const props = (s["properties"] as Record<string, JsonSchema>) ?? {};
  const required = new Set((s["required"] as string[]) ?? []);
  const rows = Object.entries(props).map(([k, v]) => {
    const t = schemaType(v);
    const req = required.has(k) ? "yes" : "—";
    const desc = (v["description"] as string) ?? "";
    return `| \`${k}\` | ${t} | ${req} | ${escapeTableCell(desc)} |`;
  });
  return rows.join("\n");
}

function schemaType(v: JsonSchema): string {
  if (v["$ref"]) return `[${String(v["$ref"]).split("/").pop()}](#${String(v["$ref"]).split("/").pop()!.toLowerCase()})`;
  if (v["enum"]) return (v["enum"] as unknown[]).map((e) => (e === null ? "null" : `\`${e}\``)).join(" \\| ");
  if (v["const"] !== undefined) return `\`${v["const"]}\``;
  if (v["type"] === "array") return `${schemaType(v["items"] as JsonSchema)}[]`;
  if (v["type"] === "object") return v["additionalProperties"] && typeof v["additionalProperties"] === "object" ? `map → ${schemaType(v["additionalProperties"] as JsonSchema)}` : "object";
  if (v["anyOf"]) return (v["anyOf"] as JsonSchema[]).map(schemaType).join(" \\| ");
  if (Array.isArray(v["type"])) return (v["type"] as string[]).join(" \\| ");
  if (v["type"]) return String(v["type"]);
  return "any";
}

const md: string[] = [];
md.push(`<!-- GENERATED by scripts/src/gen-contract.ts — do not edit. Run \`pnpm --filter @workspace/scripts run gen-contract\`. -->`);
md.push(`# OmniProject Broker Contract (${CONTRACT_VERSION})`);
md.push("");
md.push(
  "OmniProject is **broker-agnostic by design**: this document is the real interface a broker must " +
    "satisfy, generated directly from the TypeScript declarations in " +
    "`artifacts/api-server/src/broker/types.ts` and `contract.ts`. **n8n is the reference broker**; " +
    "`DemoBroker` is the reference in-process implementation that proves the seam is generic. The " +
    "machine-readable schema is [`docs/contract/broker.v1.schema.json`](contract/broker.v1.schema.json) " +
    "and is also served at `GET /api/contract`.",
);
md.push("");
md.push(`**Contract version:** \`${CONTRACT_VERSION}\` — bumped only on a breaking change to a request/response shape or control semantic; additive fields are not breaking.`);
md.push("");

md.push("## Broker actions");
md.push("");
md.push("Every operation a broker must (or, where marked optional, may) implement. Each takes an `ActorContext` first argument (forwarded actor identity) — omitted from the table.");
md.push("");
md.push("| Action | Arguments | Returns | Notes |");
md.push("| --- | --- | --- | --- |");
for (const m of brokerMethods) {
  const args = m.params.length ? m.params.map((p) => `\`${escapeTableCell(`${p.name}: ${p.type}`)}\``).join(", ") : "—";
  md.push(`| \`${m.name}\`${m.optional ? " _(optional)_" : ""} | ${args} | \`${escapeTableCell(m.returns)}\` | ${escapeTableCell(m.doc)} |`);
}
md.push("");

md.push("## Response envelope & provenance");
md.push("");
md.push(
  "An HTTP-transport broker returns the [BrokerEnvelope](#brokerenvelope) wrapper `{ success, data?, message? }`; " +
    "the gateway unwraps it before anything above the seam sees data, and treats a bare body as " +
    "`{ success: true, data: <body> }`. In-process brokers return domain values directly.",
);
md.push("");
md.push(`Derived and historical responses carry a **provenance** tag: ${(enumArrays.get("PROVENANCE_VALUES") ?? []).map((v) => `\`${v}\``).join(", ")}. The narrower per-entity unions (e.g. \`FxRates.provenance\` is only \`sourced\`/\`sample\`) are authoritative.`);
md.push("");

md.push("## Control semantics");
md.push("");
md.push("| Concept | Carrier | Semantics |");
md.push("| --- | --- | --- |");
md.push("| Dry-run | `verify: true` in the write payload / `verify()` method | Probe the contract WITHOUT mutating; returns a [VerifyReport](#verifyreport). |");
md.push("| Optimistic concurrency | `expectedVersion` on [IssueWrite](#issuewrite) | A version mismatch MUST surface as HTTP **409** (`conflict`), carrying the current row as `details`. |");
md.push("| Idempotency | `X-OmniProject-Idempotency-Key` header + `idempotencyKey` body field | Deterministic `sha256(action:projectId:issueId:minute)`; a broker MAY collapse duplicates. |");
md.push("| Origin loop-guard | `X-OmniProject-Origin` header + `origin` body field (`omniproject`) | A broker SHOULD echo this on emitted events so the gateway drops its own echoes. |");
md.push("| Action routing | `X-OmniProject-Action`, `X-OmniProject-Source` headers | The action name and backend routing hint. |");
md.push("");

md.push("## Inbound notification ingest");
md.push("");
md.push("`POST /api/notifications/ingest` — a broker or tool pushes an event in (authenticated by the `NOTIFY_INGEST_SECRET` shared secret via `Authorization: Bearer` or `X-Notify-Secret`). Body: [NotificationIngest](#notificationingest); the gateway fans out a normalised [IngestedNotification](#ingestednotification).");
md.push("");

md.push("## Outbound HMAC-signed events");
md.push("");
md.push(`The gateway can push events to subscribed endpoints. Event names: ${(enumArrays.get("OUTBOUND_EVENT_NAMES") ?? []).map((v) => `\`${v}\``).join(", ")}. Each delivery is an [OutboundEvent](#outboundevent) body with headers \`X-OmniProject-Event\`, \`X-OmniProject-Delivery\` and \`X-OmniProject-Signature\`. The signature is \`sha256=<hex HMAC-SHA256(body, subscription.secret)>\` over the exact serialised body.`);
md.push("");

md.push("## Schemas");
md.push("");
for (const name of [...defs.keys()].sort()) {
  const s = defs.get(name)!;
  md.push(`### ${name}`);
  md.push("");
  const desc = s["description"] as string | undefined;
  if (desc) {
    md.push(desc);
    md.push("");
  }
  if (s["enum"]) {
    md.push(`Enum: ${(s["enum"] as unknown[]).map((e) => (e === null ? "`null`" : `\`${e}\``)).join(", ")}`);
    md.push("");
  } else if (s["properties"]) {
    md.push("| Field | Type | Required | Description |");
    md.push("| --- | --- | --- | --- |");
    md.push(fieldRows(s));
    if (s["additionalProperties"] === true) md.push(`| _(other)_ | any | — | Open row — backend-specific fields pass through. |`);
    md.push("");
  } else {
    md.push(`Type: ${schemaType(s)}`);
    md.push("");
  }
}

if (flags.length) {
  md.push("## ⚠️ Unmapped contract fields");
  md.push("");
  md.push("The generator could not map these to a code type — review before relying on them:");
  md.push("");
  for (const f of flags) md.push(`- ${f}`);
  md.push("");
}

fs.writeFileSync(OUT_MD, md.join("\n"));

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`contract ${CONTRACT_VERSION}: ${defs.size} schemas, ${brokerMethods.length} broker actions`);
console.log(`  → ${path.relative(ROOT, OUT_SCHEMA)}`);
console.log(`  → ${path.relative(ROOT, OUT_MD)}`);
console.log(`  → ${path.relative(ROOT, OUT_TS)}`);
if (flags.length) {
  console.log(`  ${flags.length} flag(s):`);
  for (const f of flags) console.log(`    - ${f}`);
}
