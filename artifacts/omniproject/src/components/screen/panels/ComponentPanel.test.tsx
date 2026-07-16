import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test/utils";
import type { Panel } from "../../../lib/screen";

/**
 * ComponentPanel hosts a registered SPA component as a panel, passing the panel's config through as props
 * (so a threaded route param reaches the hosted component). An unknown id degrades to a placeholder.
 */
vi.mock("../screen-components", () => ({
  SCREEN_COMPONENTS: {
    "demo-page": (props: { projectId?: string }) => <div data-testid="hosted">hosted projectId={props.projectId ?? "none"}</div>,
  },
  hasScreenComponent: (id: string) => id === "demo-page",
}));

const { ComponentPanel } = await import("./ComponentPanel");

describe("ComponentPanel", () => {
  it("renders a placeholder for an unknown component id", () => {
    const panel: Panel = { id: "p", kind: "component", config: { component: "nope" } };
    renderWithProviders(<ComponentPanel panel={panel} />);
    expect(screen.getByTestId("unknown-component")).toBeTruthy();
  });

  it("hosts a registered component and threads config props through", () => {
    const panel: Panel = { id: "p", kind: "component", config: { component: "demo-page", projectId: "proj-9" } };
    renderWithProviders(<ComponentPanel panel={panel} />);
    expect(screen.getByTestId("component-panel-demo-page")).toBeTruthy();
    expect(screen.getByTestId("hosted").textContent).toContain("proj-9");
  });
});
