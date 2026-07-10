import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiBoard } from "./PiBoard";
import type { Load, Team } from "../../lib/pi-planning";

const teams: Team[] = [
  { id: "t1", name: "Alpha", capacityByIteration: [20, 20] },
  { id: "t2", name: "Bravo", capacityByIteration: [15, 15] },
];

describe("PiBoard", () => {
  it("shows an empty state with no teams", () => {
    render(<PiBoard iterations={2} teams={[]} load={[]} />);
    expect(screen.getByTestId("pi-board-empty")).toBeInTheDocument();
  });

  it("renders per-team iteration cells and flags over-commitment", () => {
    const load: Load[] = [{ teamId: "t1", iteration: 0, points: 25 }];
    render(<PiBoard iterations={2} teams={teams} load={load} />);
    expect(screen.getByTestId("pi-cell-t1-0")).toHaveTextContent("25/20");
    expect(screen.getByTestId("pi-overcommitted")).toHaveTextContent("Alpha");
  });

  it("summarises committed business value", () => {
    render(<PiBoard iterations={2} teams={teams} load={[]}
      objectives={[{ id: "o1", teamId: "t1", title: "A", businessValue: 8, committed: true }, { id: "o2", teamId: "t2", title: "B", businessValue: 2, committed: false }]} />);
    expect(screen.getByTestId("pi-commitment")).toHaveTextContent("80% BV committed (8/10)");
  });

  it("flags dependencies pointing off the ART", () => {
    render(<PiBoard iterations={2} teams={teams} load={[]}
      dependencies={[{ id: "d1", fromTeamId: "t1", toTeamId: "ghost", label: "X" }]} />);
    expect(screen.getByTestId("pi-unresolved-deps")).toBeInTheDocument();
  });
});
