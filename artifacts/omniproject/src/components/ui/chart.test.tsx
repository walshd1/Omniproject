import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ChartStyle, type ChartConfig } from "./chart";

/**
 * ChartStyle injects CSS via dangerouslySetInnerHTML from `id` and `config` — both of which can
 * originate from a customer-authored report/dashboard definition, not just developer-written
 * code. A malicious value must not be able to break out of the <style> tag or inject an extra
 * CSS rule.
 */
describe("ChartStyle", () => {
  it("renders a legitimate config's colors as CSS custom properties", () => {
    const config: ChartConfig = { revenue: { color: "#ff0000" }, cost: { color: "rgb(0, 128, 0)" } };
    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const css = container.querySelector("style")?.innerHTML ?? "";
    expect(css).toContain("[data-chart=chart-1]");
    expect(css).toContain("--color-revenue: #ff0000;");
    expect(css).toContain("--color-cost: rgb(0, 128, 0);");
  });

  it("drops a color value that attempts a <style> breakout / rule injection", () => {
    const config: ChartConfig = {
      revenue: { color: "red; } </style><script>alert(1)</script><style>.x{color:red" },
    };
    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const html = container.innerHTML;
    expect(html).not.toContain("</style><script>");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("drops a config key that isn't a safe CSS identifier", () => {
    const config = { "evil}; } .x{color:red": { color: "#fff" } } as unknown as ChartConfig;
    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const css = container.querySelector("style")?.innerHTML ?? "";
    expect(css).not.toContain("evil}");
  });

  it("renders nothing (no <style> tag) when the id itself isn't a safe CSS identifier", () => {
    const config: ChartConfig = { revenue: { color: "#fff" } };
    const { container } = render(<ChartStyle id={'chart-1] } .x{color:red'} config={config} />);
    expect(container.querySelector("style")).toBeNull();
  });
});
