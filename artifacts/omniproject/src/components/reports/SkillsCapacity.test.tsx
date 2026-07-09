import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillsCapacity } from "./SkillsCapacity";
import type { DemandRequest, ResourceSkills } from "../../lib/skills-capacity";

const resources: ResourceSkills[] = [
  { resourceId: "r1", name: "Ada", skills: { react: 4 }, capacityHours: 250 },
];
const demand: DemandRequest[] = [{ id: "d1", initiative: "Rebuild", skill: "react", hoursNeeded: 400, minProficiency: 3 }];

describe("SkillsCapacity", () => {
  it("shows an empty state when there's no matrix or demand", () => {
    render(<SkillsCapacity resources={[]} demand={[]} />);
    expect(screen.getByTestId("skills-capacity-empty")).toBeInTheDocument();
  });

  it("renders the per-skill gap and the unmet total", () => {
    render(<SkillsCapacity resources={resources} demand={demand} />);
    const row = screen.getByTestId("skill-row-react");
    expect(row).toHaveTextContent("400h"); // demand
    expect(row).toHaveTextContent("150h"); // unmet (400 - 250)
    expect(screen.getByTestId("skills-capacity-coverage")).toHaveTextContent("150h unmet");
  });

  it("flags over-allocation", () => {
    render(<SkillsCapacity resources={[{ resourceId: "r1", name: "Ada", skills: { react: 4 }, capacityHours: 50 }]}
      demand={[{ id: "d1", initiative: "x", skill: "react", hoursNeeded: 40 }, { id: "d2", initiative: "y", skill: "react", hoursNeeded: 40 }]} />);
    // Ada capped at 50h capacity; a second 40h request can't be met ⇒ unmet total shown
    expect(screen.getByTestId("skills-capacity-coverage")).toHaveTextContent("unmet");
  });
});
