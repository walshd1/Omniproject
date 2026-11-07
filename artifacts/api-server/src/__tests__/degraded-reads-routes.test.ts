import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";
import { __setBrokerFaultsForTest } from "../broker/fault-broker";
import { resetBroker } from "../broker";

/**
 * Degraded reads, end to end (docs/DEGRADED-READS.md). Before the fault hook existed this was
 * untestable — the demo broker always answers, so "3 of 4 sources reported" had no way to happen.
 *
 * The rule under test: rows that answered are real, but a total summed ACROSS sources is withheld when
 * any source is missing, because a total over a subset is wrong rather than merely smaller.
 */

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(() => { __setBrokerFaultsForTest(null); resetBroker(); });

async function summary(): Promise<Record<string, unknown>> {
  const r = await h.req("/portfolio/summary", { cookie: adminCookie() });
  assert.equal(r.status, 200, "a degraded read is still a 200 — the response describes the gap");
  return (await r.json()) as Record<string, unknown>;
}

test("baseline: with every source answering, the roll-up is complete and totals are present", async () => {
  const body = await summary();
  const avail = body["availability"] as { complete: boolean; unavailable: unknown[] };
  assert.equal(avail.complete, true);
  assert.deepEqual(avail.unavailable, []);
  // Both totals must be PRESENT here, or the "withheld" assertions below would pass vacuously.
  assert.ok(body["finance"], "finance total present when nothing failed");
  assert.ok(body["capacity"], "capacity total present when nothing failed");
});

test("the financials read failing WITHHOLDS the finance total and names the source", async () => {
  // The demo broker implements the BULK read (portfolioFinancials), so that is the call to fail —
  // the O(1) path is the one real deployments should be on. A bulk failure is deliberately NOT retried
  // per-project: that would turn one failed call into thousands against a backend already struggling.
  const projects = await (await h.req("/projects", { cookie: adminCookie() })).json() as Array<{ id: string }>;
  const victim = projects[0]!.id;
  __setBrokerFaultsForTest({ methods: ["portfolioFinancials"] });
  resetBroker();

  const body = await summary();
  const avail = body["availability"] as { complete: boolean; unavailable: Array<{ source: string }> };

  assert.equal(avail.complete, false, "the read is not complete");
  assert.equal(body["finance"], null, "a cross-source total over a SUBSET is withheld, not published");
  assert.ok(
    avail.unavailable.some((u) => u.source === `project:${victim}`),
    "the response names the source that did not answer",
  );
  // The rows that DID answer are still real — a degraded portfolio is not an empty one.
  assert.ok((body["projects"] as number) > 0, "projects that answered still render");
});

test("a capacity read failure withholds the capacity total (it used to silently cover a subset)", async () => {
  __setBrokerFaultsForTest({ methods: ["portfolioCapacity"] });
  resetBroker();

  const body = await summary();
  assert.equal((body["availability"] as { complete: boolean }).complete, false);
  assert.equal(body["capacity"], null, "capacity used to fold over the survivors and look complete");
});

test("a TOTAL outage reports unavailable, never `projects: 0`", async () => {
  // The dangerous one: listProjects degrading to [] made an outage indistinguishable from a healthy
  // org that simply has no projects.
  __setBrokerFaultsForTest({ methods: ["listProjects"], mode: "timeout" });
  resetBroker();

  const body = await summary();
  const avail = body["availability"] as { complete: boolean; unavailable: Array<{ source: string }> };
  assert.equal(avail.complete, false, "an outage is reported as an outage");
  assert.ok(avail.unavailable.some((u) => u.source === "projects"), "the missing source is named");
});

test("the degraded response carries the X-OmniProject-Sources-Unavailable header", async () => {
  __setBrokerFaultsForTest({ methods: ["listProjects"] });
  resetBroker();

  const r = await h.req("/portfolio/summary", { cookie: adminCookie() });
  assert.equal(r.headers.get("x-omniproject-sources-unavailable"), "1");
});

test("a healthy response carries NO availability header (absence is the signal)", async () => {
  const r = await h.req("/portfolio/summary", { cookie: adminCookie() });
  assert.equal(r.headers.get("x-omniproject-sources-unavailable"), null);
});
