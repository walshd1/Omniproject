import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportingBadge } from "./ReportingBadge";

describe("ReportingBadge", () => {
  it("is green and reassuring when complete", () => {
    render(<ReportingBadge present={5} total={5} />);
    const b = screen.getByTestId("reporting-badge");
    expect(b).toHaveTextContent("5/5 reporting");
    expect(b.className).toMatch(/green/);
    expect(b.getAttribute("title")).toMatch(/complete figure/i);
  });

  it("is amber and warns when partial", () => {
    render(<ReportingBadge present={3} total={5} noun="report earned value" />);
    const b = screen.getByTestId("reporting-badge");
    expect(b).toHaveTextContent("3/5 reporting");
    expect(b.className).toMatch(/amber/);
    expect(b.getAttribute("title")).toMatch(/NOT a complete figure/i);
  });

  it("renders nothing when total is zero", () => {
    const { container } = render(<ReportingBadge present={0} total={0} />);
    expect(container.firstChild).toBeNull();
  });
});
