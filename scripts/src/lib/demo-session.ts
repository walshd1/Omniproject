/**
 * Demo-auth session helper shared by the read-only harnesses (e2e-smoke,
 * stress-test) that exercise a server running without a configured IdP: GET
 * /api/auth/login issues a local session cookie they can reuse for the rest
 * of the run.
 */
export async function login(base: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  return sc ? sc.split(";")[0]! : ""; // sc truthy ⇒ split yields ≥1 element
}
