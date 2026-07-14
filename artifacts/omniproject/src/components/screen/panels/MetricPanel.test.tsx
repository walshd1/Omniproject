import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricPanel } from "./MetricPanel";
import type { Panel } from "../../../lib/screen";

/**
 * MetricPanel — a single headline number with optional unit/hint and an optional title header.
 */
const panel = (config: Record<string, unknown>, title?: string): Panel => ({ id: "m", kind: "metric", ...(title ? { title } : {}), config });

describe("MetricPanel", () => {
  it("renders the value with a title, unit and hint when all are provided", () => {
    render(<MetricPanel panel={panel({ value: 42, unit: "pts", hint: "since Monday" }, "Velocity")} />);
    expect(screen.getByText("Velocity")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("pts")).toBeInTheDocument();
    expect(screen.getByText("since Monday")).toBeInTheDocument();
  });

  it("falls back to an em dash when there is no value, and omits title/unit/hint", () => {
    render(<MetricPanel panel={panel({})} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("pts")).not.toBeInTheDocument();
  });

  it("ignores a non-string unit and a non-string hint", () => {
    render(<MetricPanel panel={panel({ value: 7, unit: 5, hint: false })} />);
    expect(screen.getByText("7")).toBeInTheDocument();
    // no unit span and no hint div rendered
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("renders a value of 0 as its own text rather than the em dash", () => {
    render(<MetricPanel panel={panel({ value: 0 })} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("tolerates a panel with no config at all (defaults to the em dash)", () => {
    render(<MetricPanel panel={{ id: "m", kind: "metric" }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
