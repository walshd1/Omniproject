import { test } from "node:test";
import assert from "node:assert/strict";
import { firstSentence, leadParagraph } from "./comment-summary";

test("leadParagraph strips block delimiters and flows the lead paragraph into one line", () => {
  assert.equal(leadParagraph("/**\n * A first line.\n * A second line.\n */"), "A first line. A second line.");
});

test("leadParagraph stops at the first blank line", () => {
  assert.equal(leadParagraph("/**\n * Summary line.\n *\n * Long detail that should be dropped.\n */"), "Summary line.");
});

test("firstSentence clips to the first complete sentence", () => {
  assert.equal(firstSentence("/** Read the collection. Then replace it wholesale. */"), "Read the collection.");
});

test("firstSentence does not break on abbreviation dots or single-letter initials", () => {
  assert.equal(firstSentence("/** Maps a field (e.g. cost) to a source. Never project data. */"), "Maps a field (e.g. cost) to a source.");
  assert.equal(firstSentence("/** Uses the J. Doe convention here. Second sentence. */"), "Uses the J. Doe convention here.");
});

test("firstSentence removes box-drawing rules only when stripRules is set", () => {
  const comment = "/** Section ──── heading. */";
  assert.equal(firstSentence(comment, { stripRules: true }), "Section heading.");
  assert.equal(firstSentence(comment), "Section ──── heading.");
});

test("firstSentence returns the whole lead when there is no sentence break", () => {
  assert.equal(firstSentence("/** A one liner with no trailing period */"), "A one liner with no trailing period");
});
