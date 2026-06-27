import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_DOMAINS } from "../lib/capabilities";
import { reportCatalogue, screenCatalogue, VIEWS, BROKER_CAPABILITY_KEYS } from "@workspace/backend-catalogue";

/**
 * Incompatibility guard — every capability a surfaceable asset REQUIRES must be a
 * real capability the system can actually report on, so the "don't show what
 * nothing supports" rule can never be defeated by a dangling/typo'd requirement
 * (which would otherwise hide the asset forever, or surface it unconditionally).
 *
 * The capability key space is the BACKEND domains (CAPABILITY_DOMAINS) plus the
 * BROKER capability keys (BROKER_CAPABILITY_KEYS); a requirement of `null`/absent
 * means "always available". This is how we know which of anything to surface based
 * on what the broker(s) + backend(s) support.
 */

const KNOWN_CAPABILITIES = new Set<string>([...CAPABILITY_DOMAINS, ...BROKER_CAPABILITY_KEYS]);

/** Collect (asset, requirement) pairs whose requirement isn't a known capability. */
function danglingRequirements(): string[] {
  const offenders: string[] = [];
  const check = (kind: string, id: string, requirement: string | null | undefined): void => {
    if (requirement && !KNOWN_CAPABILITIES.has(requirement)) offenders.push(`${kind} "${id}" requires unknown capability "${requirement}"`);
  };
  for (const r of reportCatalogue()) check("report", r.id, r.capabilities.requiresCapability);
  for (const s of screenCatalogue()) check("screen", s.id, s.capabilities.requiresCapability);
  for (const v of VIEWS) check("view", v.id, v.needs);
  return offenders;
}

test("every shipped asset requires only real capabilities (no dangling requirements)", () => {
  assert.deepEqual(
    danglingRequirements(),
    [],
    "A requirement that names no real capability would silently hide the asset forever — fix the key or add the capability.",
  );
});

test("reports and screens always DECLARE their capability requirement (even if null)", () => {
  // A surfaceable asset must say what it needs, so nothing is surfaced by oversight.
  const undeclared = [
    ...reportCatalogue().filter((r) => !("requiresCapability" in r.capabilities)).map((r) => `report ${r.id}`),
    ...screenCatalogue().filter((s) => !("requiresCapability" in s.capabilities)).map((s) => `screen ${s.id}`),
  ];
  assert.deepEqual(undeclared, []);
});
