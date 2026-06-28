import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVendorProfile, vendorCapabilities, isVendorId, demoVendorFor } from "./vendor-profile";
import { DemoBroker } from "./demo";

/**
 * The vendor profile overlay is shared by the dev broker AND the demo broker: it
 * presents a base broker AS a vendor with that vendor's declared capability surface.
 * Here it is exercised over the demonstration (demo) broker — the sales-preview path
 * that is production-safe (it only ever flavours sample data).
 */

test("isVendorId accepts real vendors and rejects neutral selectors", () => {
  assert.equal(isVendorId("openproject"), true);
  assert.equal(isVendorId("all"), false);
  assert.equal(isVendorId("none"), false);
  assert.equal(isVendorId(""), false);
  assert.equal(isVendorId(null), false);
  assert.equal(isVendorId("not-a-vendor"), false);
});

test("vendorCapabilities reads the vendor's declared surface from its JSON config", () => {
  const op = vendorCapabilities("openproject");
  assert.ok(op);
  assert.equal(op!["issues"], true);
  assert.equal(op!["financials"], false);
  assert.equal(vendorCapabilities("not-a-vendor"), null);
});

test("flavouring the DEMO broker as a vendor gates its capabilities (sales preview)", async () => {
  const demo = new DemoBroker();
  const asOpenProject = applyVendorProfile(demo, "openproject");
  assert.equal(asOpenProject.kind, "openproject-demo");
  assert.equal(asOpenProject.live, false); // still not a real integration
  const caps = await asOpenProject.capabilities({} as never);
  assert.equal(caps["issues"], true);
  assert.equal(caps["financials"], false);
  // capability-poor domains present empty, exactly as the real vendor would
  assert.deepEqual(await asOpenProject.listRaid({} as never, "proj-001"), []);
  // but the underlying demo DATA is still served for supported domains
  const projects = await asOpenProject.listProjects({} as never);
  assert.ok(projects.length > 0);
});

test("demoVendorFor: a thin-file spoof NEVER applies over real data or the dev broker", () => {
  // Pure demo mode + a vendor ⇒ flavour the demo.
  assert.equal(demoVendorFor({ devActive: false, realBackend: false, source: "openproject" }), "openproject");
  // Real backend connected (prod) ⇒ no spoof, the real vendor shows.
  assert.equal(demoVendorFor({ devActive: false, realBackend: true, source: "openproject" }), null);
  // Dev broker active ⇒ it carries its own vendor; no demo spoof on top.
  assert.equal(demoVendorFor({ devActive: true, realBackend: false, source: "openproject" }), null);
  // Neutral selector ⇒ plain demo.
  assert.equal(demoVendorFor({ devActive: false, realBackend: false, source: "all" }), null);
  assert.equal(demoVendorFor({ devActive: false, realBackend: false, source: null }), null);
});

test("a neutral/unknown selector leaves the demo broker unflavoured", async () => {
  const demo = new DemoBroker();
  assert.equal(applyVendorProfile(demo, null), demo);
  assert.equal(applyVendorProfile(demo, "all"), demo); // "all" has no caps ⇒ passthrough
  // demo keeps its full surface
  const caps = await demo.capabilities();
  assert.equal(caps["financials"], true);
});
