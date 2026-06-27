/** Fetch + parse JSON from a same-origin API endpoint. The one place the SPA's
 *  read helper lives, so query functions don't each re-declare it. */
export async function getJson<T>(url: string): Promise<T> {
  return (await fetch(url, { credentials: "same-origin" })).json();
}
