import { describe, it, expect } from "vitest";
import type { ResourceCapacity } from "@workspace/api-client-react";
import {
  deriveCapacityActuals,
  sumActualsByResource,
  capacityActualsHeadline,
  type ResourceActual,
} from "./capacity-actuals";

function plan(over: Partial<ResourceCapacity> = {}): ResourceCapacity {
  return {
    resourceId: "u-a",
    resourceName: "Alice",
    role: "Eng",
    allocationPercentage: 100,
    assignedHours: 40,
    availableHours: 40,
    utilizationState: "OPTIMAL",
    ...over,
  } as ResourceCapacity;
}
function actual(over: Partial<ResourceActual> = {}): ResourceActual {
  return { resourceId: "u-a", resourceName: "Alice", loggedHours: 40, ...over };
}

describe("sumActualsByResource", () => {
  it("sums logged hours per resource key and skips zero/missing", () => {
    const m = sumActualsByResource([
      actual({ resourceId: "u-a", loggedHours: 10 }),
      actual({ resourceId: "u-a", loggedHours: 5 }),
      actual({ resourceId: "u-b", resourceName: "Bob", loggedHours: 0 }),
      actual({ resourceId: null, resourceName: null, loggedHours: 8 }), // no key → dropped
    ]);
    expect(m.get("u-a")?.loggedHours).toBe(15);
    expect(m.has("u-b")).toBe(false);
  });

  it("falls back to resourceName when there is no id", () => {
    const m = sumActualsByResource([actual({ resourceId: null, resourceName: "Carol", loggedHours: 4 })]);
    expect(m.get("Carol")?.loggedHours).toBe(4);
  });
});

describe("deriveCapacityActuals", () => {
  it("joins plan to actuals and derives variance + delivery percentage", () => {
    const s = deriveCapacityActuals([plan({ assignedHours: 40 })], [actual({ loggedHours: 30 })]);
    const row = s.rows[0]!;
    expect(row.plannedHours).toBe(40);
    expect(row.loggedHours).toBe(30);
    expect(row.varianceHours).toBe(-10);
    expect(row.deliveryPercentage).toBe(75);
    expect(row.state).toBe("UNDER_DELIVERED");
  });

  it("flags over-delivery above 100% of plan", () => {
    const s = deriveCapacityActuals([plan({ assignedHours: 40 })], [actual({ loggedHours: 60 })]);
    expect(s.rows[0]!.state).toBe("OVER_DELIVERED");
    expect(s.rows[0]!.deliveryPercentage).toBe(150);
    expect(s.rows[0]!.varianceHours).toBe(20);
    expect(s.overDelivered).toBe(1);
  });

  it("treats within-band delivery as ON_TRACK", () => {
    const s = deriveCapacityActuals([plan({ assignedHours: 40 })], [actual({ loggedHours: 40 })]);
    expect(s.rows[0]!.state).toBe("ON_TRACK");
    expect(s.onTrack).toBe(1);
  });

  it("zero allocation → NO_PLAN with null delivery percentage", () => {
    const s = deriveCapacityActuals(
      [plan({ resourceId: "u-z", resourceName: "Zoe", assignedHours: 0, allocationPercentage: 0 })],
      [actual({ resourceId: "u-z", resourceName: "Zoe", loggedHours: 12 })],
    );
    expect(s.rows[0]!.state).toBe("NO_PLAN");
    expect(s.rows[0]!.deliveryPercentage).toBeNull();
    expect(s.rows[0]!.varianceHours).toBe(12);
    expect(s.noPlan).toBe(1);
  });

  it("no logged hours → 0% delivery, under-delivered against a real plan", () => {
    const s = deriveCapacityActuals([plan({ assignedHours: 40 })], []);
    expect(s.rows[0]!.loggedHours).toBe(0);
    expect(s.rows[0]!.deliveryPercentage).toBe(0);
    expect(s.rows[0]!.state).toBe("UNDER_DELIVERED");
    expect(s.totalLoggedHours).toBe(0);
  });

  it("actuals with no matching plan appear as NO_PLAN rows", () => {
    const s = deriveCapacityActuals(
      [plan({ resourceId: "u-a", assignedHours: 40 })],
      [actual({ resourceId: "u-a", loggedHours: 40 }), actual({ resourceId: "u-ghost", resourceName: "Ghost", loggedHours: 7 })],
    );
    const ghost = s.rows.find((r) => r.resourceId === "u-ghost")!;
    expect(ghost.state).toBe("NO_PLAN");
    expect(ghost.plannedHours).toBe(0);
    expect(ghost.loggedHours).toBe(7);
    expect(s.noPlan).toBe(1);
  });

  it("handles missing/undefined fields safely (coerced to 0)", () => {
    const s = deriveCapacityActuals(
      [{ resourceId: "u-a", resourceName: "Alice", role: "Eng" } as unknown as ResourceCapacity],
      [actual({ loggedHours: 5 })],
    );
    expect(s.rows[0]!.plannedHours).toBe(0);
    expect(s.rows[0]!.availableHours).toBe(0);
    expect(s.rows[0]!.state).toBe("NO_PLAN");
  });

  it("rolls up portfolio totals and sorts most over-delivered first", () => {
    const s = deriveCapacityActuals(
      [
        plan({ resourceId: "u-a", resourceName: "Alice", assignedHours: 40 }),
        plan({ resourceId: "u-b", resourceName: "Bob", assignedHours: 40 }),
      ],
      [
        actual({ resourceId: "u-a", loggedHours: 20 }), // under by 20
        actual({ resourceId: "u-b", resourceName: "Bob", loggedHours: 60 }), // over by 20
      ],
    );
    expect(s.rows.map((r) => r.resourceId)).toEqual(["u-b", "u-a"]); // over-delivered first
    expect(s.totalPlannedHours).toBe(80);
    expect(s.totalLoggedHours).toBe(80);
    expect(s.totalVarianceHours).toBe(0);
    expect(s.overallDeliveryPercentage).toBe(100);
    expect(s.overDelivered).toBe(1);
    expect(s.underDelivered).toBe(1);
  });

  it("empty input is safe", () => {
    const s = deriveCapacityActuals([], []);
    expect(s.rows).toEqual([]);
    expect(s.overallDeliveryPercentage).toBeNull();
    expect(s.totalVarianceHours).toBe(0);
    expect(capacityActualsHeadline(s)).toMatch(/No capacity data/);
  });
});

describe("capacityActualsHeadline", () => {
  it("summarises posture in one line", () => {
    const s = deriveCapacityActuals([plan({ assignedHours: 40 })], [actual({ loggedHours: 60 })]);
    const h = capacityActualsHeadline(s);
    expect(h).toContain("60h logged vs 40h planned");
    expect(h).toContain("150%");
    expect(h).toContain("+20h");
    expect(h).toContain("1 over-");
  });
});
