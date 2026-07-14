import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateResourcePool } from "./resource-pool";
import type { ProjectMember } from "../broker/types";

const m = (over: Partial<ProjectMember> & { id: string }): ProjectMember => ({ access: "write", ...over }) as ProjectMember;

test("aggregateResourcePool dedupes people, unions skills, sums capacity, collects projects", () => {
  const pool = aggregateResourcePool([
    { projectId: "p1", members: [m({ id: "ada", name: "Ada", skills: ["backend"], availableHours: 40, allocatedHours: 20 })] },
    { projectId: "p2", members: [m({ id: "ada", name: "Ada", skills: ["architecture"], availableHours: 10, allocatedHours: 5 })] },
    { projectId: "p2", members: [m({ id: "grace", name: "Grace", skills: ["compilers"] })] },
  ]);

  const ada = pool.find((r) => r.id === "ada")!;
  assert.deepEqual(ada.skills.sort(), ["architecture", "backend"]);
  assert.equal(ada.availableHours, 50);
  assert.equal(ada.allocatedHours, 25);
  assert.deepEqual(ada.projectIds.sort(), ["p1", "p2"]);

  // capacity stays null when no project supplied a number (distinct from 0)
  const grace = pool.find((r) => r.id === "grace")!;
  assert.equal(grace.availableHours, null);
  assert.equal(grace.allocatedHours, null);
});

test("aggregateResourcePool ignores a NaN/Infinity capacity instead of poisoning the pool total", () => {
  const pool = aggregateResourcePool([
    { projectId: "p1", members: [m({ id: "ada", availableHours: 40, allocatedHours: 20 })] },
    { projectId: "p2", members: [m({ id: "ada", availableHours: NaN, allocatedHours: Infinity })] }, // dirty adapter row
    { projectId: "p3", members: [m({ id: "ada", availableHours: 10, allocatedHours: 5 })] },
  ]);
  const ada = pool.find((r) => r.id === "ada")!;
  assert.equal(ada.availableHours, 50); // 40 + 10, the NaN row skipped (not 40 + NaN + 10 = NaN)
  assert.equal(ada.allocatedHours, 25);
});

test("aggregateResourcePool sorts by display name and is empty for no rosters", () => {
  assert.deepEqual(aggregateResourcePool([]), []);
  const pool = aggregateResourcePool([
    { projectId: "p1", members: [m({ id: "z", name: "Zoe" }), m({ id: "a", name: "Aaron" })] },
  ]);
  assert.deepEqual(pool.map((r) => r.id), ["a", "z"]);
});
