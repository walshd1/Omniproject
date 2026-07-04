import fs from "node:fs";
import path from "node:path";

/** Which files a walk collects: by extension, with optional filename-suffix exclusions
 *  (e.g. test/spec files) checked before the extension match is returned. */
export interface WalkOptions {
  extensions: string[];
  excludeSuffixes?: string[];
}

/**
 * Recursively collect files under `dir` matching `extensions` (and not matching any
 * `excludeSuffixes`), depth-first. Returned paths are joined onto whatever form of `dir` was
 * passed in — absolute in, absolute out; repo-relative in, repo-relative out — so callers that
 * need root-relative paths pass a root-relative `dir` (or resolve the result themselves).
 */
export function walkFiles(dir: string, opts: WalkOptions): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, opts));
      continue;
    }
    if (!opts.extensions.some((ext) => entry.name.endsWith(ext))) continue;
    if (opts.excludeSuffixes?.some((suffix) => entry.name.endsWith(suffix))) continue;
    out.push(full);
  }
  return out;
}
