import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSkillsGap, PROFICIENCY_RANK, type SkillHolding, type SkillRequirement } from "./skills-gap";

const H = (resourceId: string, skillId: string, proficiency?: string): SkillHolding => ({ resourceId, skillId, ...(proficiency !== undefined ? { proficiency } : {}) });
const round2 = (n: number) => Math.round(n * 100) / 100;

test("computes supply / gap / coverage per required skill", () => {
  const holdings = [H("r1", "k8s", "advanced"), H("r2", "k8s", "expert"), H("r3", "k8s", "novice")];
  const reqs: SkillRequirement[] = [{ skillId: "k8s", requiredLevel: "advanced", requiredCount: 3 }];
  const { skills, summary } = analyzeSkillsGap(holdings, reqs);
  const g = skills[0]!;
  assert.equal(g.supply, 2); // r1 (advanced) + r2 (expert) qualify; r3 (novice) does not
  assert.equal(g.totalHolders, 3);
  assert.equal(g.requiredCount, 3);
  assert.equal(g.gap, 1);
  assert.equal(g.coverage, round2(2 / 3));
  assert.equal(g.covered, false);
  assert.equal(summary.gapSkills, 1);
  assert.equal(summary.totalGap, 1);
  assert.equal(summary.resources, 3);
});

test("a fully-staffed skill is covered with zero gap", () => {
  const { skills, summary } = analyzeSkillsGap([H("r1", "react", "expert"), H("r2", "react", "advanced")], [{ skillId: "react", requiredLevel: "advanced", requiredCount: 2 }]);
  assert.equal(skills[0]!.gap, 0);
  assert.equal(skills[0]!.covered, true);
  assert.equal(summary.coveredSkills, 1);
});

test("absent requiredLevel ⇒ any holder qualifies (rank 0)", () => {
  const { skills } = analyzeSkillsGap([H("r1", "go", "novice"), H("r2", "go")], [{ skillId: "go", requiredCount: 2 }]);
  assert.equal(skills[0]!.requiredRank, 0);
  assert.equal(skills[0]!.supply, 2); // both count, even the unknown-proficiency one
  assert.equal(skills[0]!.gap, 0);
});

test("a missing skill (no holders) is a full gap", () => {
  const { skills } = analyzeSkillsGap([], [{ skillId: "rust", requiredLevel: "expert", requiredCount: 2 }]);
  assert.equal(skills[0]!.supply, 0);
  assert.equal(skills[0]!.gap, 2);
  assert.equal(skills[0]!.coverage, 0);
  assert.equal(skills[0]!.meanProficiency, null);
});

test("ranks worst-gap first, then lowest coverage, then id", () => {
  const holdings = [H("r1", "a", "expert"), H("r1", "b", "expert"), H("r2", "b", "expert")];
  const reqs: SkillRequirement[] = [
    { skillId: "a", requiredLevel: "expert", requiredCount: 3 }, // gap 2
    { skillId: "b", requiredLevel: "expert", requiredCount: 3 }, // gap 1
    { skillId: "c", requiredLevel: "expert", requiredCount: 5 }, // gap 5
  ];
  const { skills } = analyzeSkillsGap(holdings, reqs);
  assert.deepEqual(skills.map((s) => s.skillId), ["c", "a", "b"]); // gaps 5,2,1
});

test("a resource listed twice for a skill keeps its highest level", () => {
  const { skills } = analyzeSkillsGap([H("r1", "k8s", "novice"), H("r1", "k8s", "expert")], [{ skillId: "k8s", requiredLevel: "advanced", requiredCount: 1 }]);
  assert.equal(skills[0]!.totalHolders, 1); // one distinct resource
  assert.equal(skills[0]!.supply, 1); // expert >= advanced qualifies
});

test("bench surfaces held-but-not-required skills, most-held first", () => {
  const holdings = [H("r1", "held", "expert"), H("r2", "held", "advanced"), H("r1", "req", "expert")];
  const { bench } = analyzeSkillsGap(holdings, [{ skillId: "req", requiredCount: 1 }]);
  assert.deepEqual(bench, [{ skillId: "held", holders: 2 }]);
});

test("a custom proficiency ladder overrides the default", () => {
  const rank = { junior: 1, senior: 5 };
  const { skills } = analyzeSkillsGap([H("r1", "x", "senior"), H("r2", "x", "junior")], [{ skillId: "x", requiredLevel: "senior", requiredCount: 2 }], { proficiencyRank: rank });
  assert.equal(skills[0]!.supply, 1); // only the senior qualifies
  assert.equal(skills[0]!.gap, 1);
});

test("duplicate requirements for a skill keep the strictest", () => {
  const reqs: SkillRequirement[] = [
    { skillId: "k8s", requiredLevel: "novice", requiredCount: 1 },
    { skillId: "k8s", requiredLevel: "expert", requiredCount: 3 },
  ];
  const { skills } = analyzeSkillsGap([H("r1", "k8s", "expert")], reqs);
  assert.equal(skills[0]!.requiredLevel, "expert");
  assert.equal(skills[0]!.requiredCount, 3);
});

test("empty in ⇒ empty out", () => {
  const r = analyzeSkillsGap([], []);
  assert.deepEqual(r.skills, []);
  assert.deepEqual(r.bench, []);
  assert.deepEqual(r.summary, { requiredSkills: 0, coveredSkills: 0, gapSkills: 0, totalGap: 0, resources: 0 });
});

test("malformed input tolerated: non-objects dropped, ids coerced, dirty count/level never throws", () => {
  const holdings = [null, 42, { resourceId: 7, skillId: "k8s", proficiency: "expert" }, { resourceId: "  ", skillId: "k8s" }] as unknown as SkillHolding[];
  const reqs = [{ skillId: "k8s", requiredLevel: "bogus", requiredCount: "xyz" }] as unknown as SkillRequirement[];
  const { skills, summary } = analyzeSkillsGap(holdings, reqs);
  assert.equal(summary.resources, 1); // only "7" (coerced); blank id dropped
  assert.equal(skills[0]!.requiredRank, 0); // unknown level ⇒ rank 0
  assert.equal(skills[0]!.requiredCount, 1); // dirty count ⇒ default 1
  assert.equal(skills[0]!.supply, 1);
});

test("deterministic: same input ⇒ identical output", () => {
  const holdings = [H("r1", "a", "expert"), H("r2", "a", "novice")];
  const reqs: SkillRequirement[] = [{ skillId: "a", requiredLevel: "advanced", requiredCount: 2 }];
  assert.deepEqual(analyzeSkillsGap(holdings, reqs), analyzeSkillsGap(holdings, reqs));
  assert.deepEqual(PROFICIENCY_RANK, { novice: 1, intermediate: 2, advanced: 3, expert: 4 });
});
