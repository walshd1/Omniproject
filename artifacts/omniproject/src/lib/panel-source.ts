/**
 * Panel source-URL templating — lets a JSON-authored panel bind a SCOPED endpoint with a `{token}`
 * placeholder that the engine fills from the active render context (today: `{projectId}` from the session's
 * active project). Generic on purpose: ANY artifact can bind e.g. `/api/projects/{projectId}/…` with no
 * bespoke component. Returns the resolved URL and whether any placeholder was left unresolved, so a panel can
 * hold off fetching instead of hitting a malformed URL.
 */
export function resolveSourceUrl(url: string, vars: Record<string, string | undefined>): { url: string; unresolved: boolean } {
  let unresolved = false;
  const out = url.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v == null || v === "") { unresolved = true; return `{${key}}`; }
    return encodeURIComponent(v);
  });
  return { url: out, unresolved };
}
