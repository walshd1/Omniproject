import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArtifactRenderer } from "./ArtifactRenderer";
import type { BuiltinArtifactDef } from "../../definitions/builtin-defs";
import type { Row } from "../../lib/custom-report";

describe("ArtifactRenderer", () => {
  it("renders a chart artifact through ChartView (self-contained JSON spec)", () => {
    const def: BuiltinArtifactDef = {
      id: "plan", kind: "chart", label: "Plan", builtin: true,
      spec: { type: "gantt", items: [{ label: "Design", start: "2026-01-01", end: "2026-02-01" }] },
    };
    render(<ArtifactRenderer def={def} />);
    expect(screen.getByTestId("gantt-chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Design: 2026-01-01 to 2026-02-01")).toBeInTheDocument();
  });

  it("renders a report artifact through the report engine over supplied rows", () => {
    const def: BuiltinArtifactDef = {
      id: "by-priority", kind: "report", label: "By priority", builtin: true,
      spec: { scope: "portfolio", viz: "bar", groupBy: "priority", metrics: [{ id: "count", field: "id", agg: "count" }] },
    };
    const rows: Row[] = [{ id: "a", priority: "high" }, { id: "b", priority: "high" }, { id: "c", priority: "low" }];
    render(<ArtifactRenderer def={def} rows={rows} />);
    expect(screen.getByTestId("custom-report-by-priority")).toBeInTheDocument();
    expect(screen.getByTestId("custom-report-row-by-priority-high")).toBeInTheDocument();
  });

  it("degrades a malformed report spec to an inline error, not a throw", () => {
    const def: BuiltinArtifactDef = { id: "bad", kind: "report", label: "Bad", builtin: true, spec: { scope: "portfolio", viz: "bar", metrics: [] } };
    render(<ArtifactRenderer def={def} rows={[]} />);
    expect(screen.getByTestId("artifact-error-bad")).toBeInTheDocument();
  });

  it("notes that a view artifact renders in its entity view", () => {
    const def: BuiltinArtifactDef = { id: "tasks", kind: "view", label: "Tasks", builtin: true, spec: { entity: "task", viewKind: "chart" } };
    render(<ArtifactRenderer def={def} />);
    expect(screen.getByTestId("artifact-view-tasks")).toBeInTheDocument();
  });
});
