import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOC_BLOCK_TYPES, TEXT_BLOCK_TYPES, LIST_BLOCK_TYPES, CALLOUT_TONES,
  parseWikiLinks, docWikiLinks, slugifyDocTitle, type DocBlock,
} from "./wiki-catalogue";

test("block-type registry is well-formed: unique, and text/list subsets are contained", () => {
  assert.equal(new Set(DOC_BLOCK_TYPES).size, DOC_BLOCK_TYPES.length);
  for (const t of TEXT_BLOCK_TYPES) assert.ok(DOC_BLOCK_TYPES.includes(t), `text type ${t} in registry`);
  for (const t of LIST_BLOCK_TYPES) assert.ok(DOC_BLOCK_TYPES.includes(t), `list type ${t} in registry`);
  assert.ok(CALLOUT_TONES.length > 0);
});

test("parseWikiLinks extracts [[targets]], deduped and in order, with optional alias", () => {
  assert.deepEqual(parseWikiLinks("see [[Onboarding]] and [[Runbook|the runbook]] then [[Onboarding]]"), ["Onboarding", "Runbook"]);
  assert.deepEqual(parseWikiLinks("no links here"), []);
});

test("docWikiLinks gathers targets across text, list items and table cells", () => {
  const blocks: DocBlock[] = [
    { id: "b1", type: "paragraph", text: "intro [[Alpha]]" },
    { id: "b2", type: "checklist", items: [{ text: "do [[Beta]]", checked: false }] },
    { id: "b3", type: "table", rows: [["[[Gamma]]", "plain"]] },
    { id: "b4", type: "paragraph", text: "again [[Alpha]]" },
  ];
  assert.deepEqual(docWikiLinks(blocks), ["Alpha", "Beta", "Gamma"]);
});

test("slugifyDocTitle produces a url-safe slug and never empty", () => {
  assert.equal(slugifyDocTitle("Hello, World!"), "hello-world");
  assert.equal(slugifyDocTitle("  Spaced  Out  "), "spaced-out");
  assert.equal(slugifyDocTitle("!!!"), "untitled");
});
