import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Panel } from "../../../lib/screen";
import { FieldPanel } from "./FieldPanel";

describe("FieldPanel (decisions rendered as live fields)", () => {
  it("renders a control per decision, driven by each decision's type", () => {
    const panel: Panel = {
      id: "s",
      kind: "field",
      title: "Preferences",
      config: {
        decisions: [
          { label: "Notifications", type: "boolean", value: "on" },
          { label: "Density", type: "single-choice", options: ["comfortable", "compact"], value: "compact" },
        ],
      },
    };
    render(<FieldPanel panel={panel} />);
    // The boolean decision → a switch; the choice decision → a select.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("compact");
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("a boolean field toggles live", () => {
    const panel: Panel = { id: "s2", kind: "field", config: { decision: { label: "Dark mode", type: "boolean", value: "off" } } };
    render(<FieldPanel panel={panel} />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("shows an empty state when there are no valid decisions", () => {
    render(<FieldPanel panel={{ id: "s3", kind: "field", config: { decisions: [{ label: "x", type: "nope" }] } }} />);
    expect(screen.getByText("No settings.")).toBeInTheDocument();
  });
});
