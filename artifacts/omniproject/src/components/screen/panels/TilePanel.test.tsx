import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TilePanel } from "./TilePanel";
import type { Panel } from "../../../lib/screen";

/**
 * TilePanel is the runtime of the base `tile` atom on a screen: it maps a panel's config
 * (content/size/color/shape/clickable/action) onto the shared Tile, STATIC by default and a
 * navigating button when `clickable` + `action` are both set. These cover content fallbacks,
 * the size/shape validation gates, colour passthrough and the clickable/navigate branches.
 */
describe("TilePanel", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it("renders static content from config.content", () => {
    const panel: Panel = { id: "t", kind: "tile", config: { content: "Hello tile" } };
    render(<TilePanel panel={panel} />);
    expect(screen.getByText("Hello tile")).toBeInTheDocument();
    // Not clickable ⇒ a plain div, not a button.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to panel.title when config has no content", () => {
    const panel: Panel = { id: "t", kind: "tile", title: "Titled tile", config: {} };
    render(<TilePanel panel={panel} />);
    expect(screen.getByText("Titled tile")).toBeInTheDocument();
  });

  it("renders empty content when neither content nor title is set", () => {
    const panel: Panel = { id: "t", kind: "tile" };
    const { container } = render(<TilePanel panel={panel} />);
    // A tile is still rendered (the bordered box), just with no text.
    expect(container.querySelector("div.border")).toBeTruthy();
  });

  it("applies a valid size, shape and colour", () => {
    const panel: Panel = {
      id: "t", kind: "tile",
      config: { content: "Styled", size: "large", shape: "pill", color: "#ff0000" },
    };
    const { container } = render(<TilePanel panel={panel} />);
    const el = container.querySelector("div.border") as HTMLElement;
    // large size + pill shape classes come through from Tile.
    expect(el.className).toContain("px-6"); // large
    expect(el.className).toContain("rounded-full"); // pill
    expect(el.style.backgroundColor).toBeTruthy();
  });

  it("ignores an invalid size / shape and a non-string colour (falls back to Tile defaults)", () => {
    const panel: Panel = {
      id: "t", kind: "tile",
      config: { content: "Bad", size: "gigantic", shape: "hexagon", color: 123 },
    };
    const { container } = render(<TilePanel panel={panel} />);
    const el = container.querySelector("div.border") as HTMLElement;
    // Tile default size=medium (px-4) + shape=rounded (rounded-lg); no bg colour applied.
    expect(el.className).toContain("px-4");
    expect(el.className).toContain("rounded-lg");
    expect(el.style.backgroundColor).toBe("");
  });

  it("renders a clickable button that navigates to the action", () => {
    const panel: Panel = {
      id: "t", kind: "tile",
      config: { content: "Go", clickable: true, action: "/reports/board" },
    };
    render(<TilePanel panel={panel} />);
    const btn = screen.getByRole("button", { name: "Go" });
    fireEvent.click(btn);
    expect(window.location.pathname).toBe("/reports/board");
  });

  it("is a button but does not navigate when clickable without an action", () => {
    const panel: Panel = { id: "t", kind: "tile", config: { content: "Inert", clickable: true } };
    render(<TilePanel panel={panel} />);
    const btn = screen.getByRole("button", { name: "Inert" });
    fireEvent.click(btn);
    // No action ⇒ no onClick wired ⇒ stays on the current path.
    expect(window.location.pathname).toBe("/");
  });

  it("stays static when clickable is not literally true", () => {
    const panel: Panel = { id: "t", kind: "tile", config: { content: "Nope", clickable: "yes", action: "/x" } };
    render(<TilePanel panel={panel} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
