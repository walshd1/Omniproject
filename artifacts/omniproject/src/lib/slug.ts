/** Filename / id-safe slug: trim, lower-case, collapse every run of non-alphanumerics to a single
 *  dash, and strip leading/trailing dashes. Returns `fallback` when the input slugs to empty. The one
 *  shared home for the slugify idiom the export/report/view builders each used to re-declare inline. */
export function slug(input: string, fallback = ""): string {
  const s = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}
