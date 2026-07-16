import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrimitiveMessages, parsePrimitiveReply, generatePrimitiveBundle,
  primitiveStudioSystemPrompt, PrimitiveStudioParseError,
} from "../lib/primitive-studio";

/**
 * The Primitive Studio skill (roadmap X.2) — generate a candidate primitive from a description, then TEST it
 * against the shared schema. Pure + injectable: a canned `complete` stands in for the AI provider.
 */

const GOOD_REPLY = JSON.stringify({
  kind: "primitive", name: "Grouped columns", publisher: "Acme", version: "1.0.0",
  description: "Compare series across categories.", tags: ["chart", "comparison"],
  payload: {
    id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar",
    description: "Compare several series across a few categories.",
    params: [
      { key: "data", label: "Rows", type: "rows", required: true, description: "One object per category." },
      { key: "series", label: "Series", type: "series", required: true, description: "Which keys to plot." },
    ],
  },
});

test("the system prompt names the closed sets and forbids code", () => {
  const p = primitiveStudioSystemPrompt();
  assert.match(p, /"kind": "primitive"/);
  assert.match(p, /bar, line, area/);
  assert.match(p, /NEVER emit code/);
});

test("iteration messages include the previous payload and the feedback", () => {
  const msgs = buildPrimitiveMessages({ description: "a bar chart", feedback: "make it horizontal", previous: { id: "x" } });
  assert.equal(msgs[0]!.role, "system");
  assert.match(msgs[1]!.content, /previous attempt/);
  assert.match(msgs[1]!.content, /make it horizontal/);
  assert.match(msgs[1]!.content, /"id":"x"/);
});

test("a good reply generates a valid, normalised bundle", async () => {
  const result = await generatePrimitiveBundle({ description: "grouped columns" }, async () => GOOD_REPLY);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.submission.kind, "primitive");
  assert.equal(result.def?.id, "grouped-column");
  assert.equal(result.def?.chartType, "bar");
});

test("a structurally-wrong primitive comes back valid:false with errors (no throw)", async () => {
  const badReply = JSON.stringify({
    name: "Bad", payload: { id: "Bad Id", label: "", category: "nope", params: [] },
  });
  const result = await generatePrimitiveBundle({ description: "something" }, async () => badReply);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
  assert.equal(result.def, undefined);
  // Identity is defaulted, never trusted blindly.
  assert.equal(result.submission.publisher.length > 0, true);
});

test("a non-JSON reply raises a parse error", async () => {
  await assert.rejects(
    generatePrimitiveBundle({ description: "x" }, async () => "sorry, I can't do that"),
    PrimitiveStudioParseError,
  );
});

test("parsePrimitiveReply defaults identity fields and requires a payload object", () => {
  const s = parsePrimitiveReply(JSON.stringify({ payload: { id: "x" } }));
  assert.equal(s.name, "Untitled primitive");
  assert.equal(s.version, "1.0.0");
  assert.throws(() => parsePrimitiveReply(JSON.stringify({ name: "no payload" })), PrimitiveStudioParseError);
});
