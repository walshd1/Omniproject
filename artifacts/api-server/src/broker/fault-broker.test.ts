import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseFaultEnv, faultMatches, faultError, brokerFaultsArmed,
  __setBrokerFaultsForTest, wrapWithFaults, type FaultSpec,
} from "./fault-broker";
import type { Broker } from "./types";

afterEach(() => { __setBrokerFaultsForTest(null); delete process.env["DEV_BROKER_FAULTS"]; });

test("DISARMED by default — production must never inject a fault", () => {
  // NODE_ENV is production under the test harness, and no hook is set: nothing armed.
  assert.equal(brokerFaultsArmed(), false);
});

test("the env knob is IGNORED outside dev mode (the production gate)", () => {
  process.env["DEV_BROKER_FAULTS"] = "listProjects";
  // isDevMode() is false here, so the env is not consulted at all.
  assert.equal(brokerFaultsArmed(), false, "a deployed instance cannot be made to fail by configuration");
});

test("the in-process test hook arms regardless of dev mode (it has no config surface)", () => {
  __setBrokerFaultsForTest({ methods: ["listProjects"] });
  assert.equal(brokerFaultsArmed(), true);
  __setBrokerFaultsForTest(null);
  assert.equal(brokerFaultsArmed(), false);
});

test("parseFaultEnv: method, method:arg, @timeout, and multiples", () => {
  assert.deepEqual(parseFaultEnv("listProjects"), [{ methods: ["listProjects"], mode: "error" }]);
  assert.deepEqual(parseFaultEnv("projectFinancials:p-2"), [{ methods: ["projectFinancials"], mode: "error", args: ["p-2"] }]);
  assert.deepEqual(parseFaultEnv("listProjects@timeout"), [{ methods: ["listProjects"], mode: "timeout" }]);
  assert.equal(parseFaultEnv("a:1,b:2")?.length, 2);
});

test("parseFaultEnv: junk degrades to NO faults, never to fail-everything", () => {
  // A typo in a dev env var must not turn into a total outage that looks like a product bug.
  assert.equal(parseFaultEnv(undefined), null);
  assert.equal(parseFaultEnv("   "), null);
  assert.equal(parseFaultEnv(",,,"), null);
});

test("faultMatches: method and argument selection", () => {
  const spec: FaultSpec = { methods: ["projectFinancials"], args: ["p-2"] };
  assert.equal(faultMatches(spec, "projectFinancials", [{}, "p-2"]), true);
  assert.equal(faultMatches(spec, "projectFinancials", [{}, "p-9"]), false, "a different project is untouched");
  assert.equal(faultMatches(spec, "listProjects", [{}, "p-2"]), false, "a different method is untouched");
  assert.equal(faultMatches({ methods: [] }, "anything", []), true, "empty methods ⇒ every method");
  assert.equal(faultMatches({ methods: ["m"] }, "m", []), true, "empty args ⇒ every call of that method");
});

test("faultError: timeout mode is shaped so timeout handling recognises it", () => {
  assert.equal(faultError({ mode: "timeout" }, "listProjects").name, "TimeoutError");
  assert.equal(faultError({ mode: "error" }, "listProjects").name, "Error");
  assert.match(faultError({}, "listProjects").message, /injected/, "obviously synthetic, never mistaken for a real backend error");
});

test("wrapWithFaults fails ONLY the selected call and passes everything else through", async () => {
  const base = {
    listProjects: async () => [{ id: "p-1" }],
    projectFinancials: async (_ctx: unknown, id: string) => ({ id, budget: 10 }),
  } as unknown as Broker;
  const wrapped = wrapWithFaults(base);

  __setBrokerFaultsForTest({ methods: ["projectFinancials"], args: ["p-2"] });
  await assert.rejects(() => (wrapped as unknown as { projectFinancials: (c: unknown, i: string) => Promise<unknown> }).projectFinancials({}, "p-2"));
  // The same method for a different project, and a different method entirely, both still work.
  assert.deepEqual(await (wrapped as unknown as { projectFinancials: (c: unknown, i: string) => Promise<unknown> }).projectFinancials({}, "p-1"), { id: "p-1", budget: 10 });
  assert.deepEqual(await wrapped.listProjects({} as never), [{ id: "p-1" }]);
});

test("wrapWithFaults is a pass-through when disarmed", async () => {
  const base = { listProjects: async () => [{ id: "p-1" }] } as unknown as Broker;
  const wrapped = wrapWithFaults(base);
  assert.deepEqual(await wrapped.listProjects({} as never), [{ id: "p-1" }]);
});
