/**
 * Reduce a raw leading-comment block to a one-line summary — the single shared summariser behind the
 * documentation generators (`gen-function-map`, `gen-api-reference`), which each need "first sentence of
 * the comment above this symbol" and were carrying their own near-identical copy. One source of truth so
 * the two generated docs can't drift in how they clip a comment.
 */

/** Abbreviations (and a bare single capital initial) whose trailing dot must NOT end the summary sentence. */
const ABBREVIATIONS = "e\\.g|i\\.e|etc|vs|cf|no|[A-Z]";
const SENTENCE_END = new RegExp(`(?<!\\b(?:${ABBREVIATIONS}))\\. `);

/**
 * Strip the comment delimiters (`/**`, leading `*`/`/`), drop blank-line-separated trailing paragraphs
 * and flow the lead paragraph into a single line of prose. `stripRules` also removes box-drawing rules
 * (`─`) that some block comments use as visual separators.
 */
export function leadParagraph(comment: string, opts: { stripRules?: boolean } = {}): string {
  const lines = comment
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => {
      const stripped = l.replace(/^\s*[/*]+/, "");
      return (opts.stripRules ? stripped.replace(/─+/g, "") : stripped).trim();
    });
  const lead: string[] = [];
  for (const l of lines) {
    if (!l) {
      if (lead.length) break; // a blank line ends the lead paragraph
      continue;
    }
    lead.push(l);
  }
  return lead.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Collapse a raw comment block to its first complete sentence (the summary): the lead paragraph clipped at
 * its first sentence-ending period, ignoring abbreviation dots (`e.g.`, `i.e.`, `etc.`) and single-letter
 * initials so a legitimate mid-sentence dot doesn't truncate it early.
 */
export function firstSentence(comment: string, opts: { stripRules?: boolean } = {}): string {
  const text = leadParagraph(comment, opts);
  const m = SENTENCE_END.exec(text);
  return m ? text.slice(0, m.index + 1) : text;
}
