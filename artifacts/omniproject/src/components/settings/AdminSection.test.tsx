import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminSection } from "./AdminSection";

function Icon({ className }: { className?: string }) {
  return <svg data-testid="icon" className={className} />;
}

describe("AdminSection", () => {
  it("renders the icon, title, testid and children in a card body", () => {
    render(
      <AdminSection icon={Icon} title="Project GUIDs" testId="guid-aliases-admin">
        <button>Add relink</button>
      </AdminSection>,
    );
    expect(screen.getByTestId("guid-aliases-admin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project GUIDs" })).toBeInTheDocument();
    expect(screen.getByTestId("icon").getAttribute("class")).toContain("w-4 h-4 text-muted-foreground");
    expect(screen.getByRole("button", { name: "Add relink" })).toBeInTheDocument();
  });

  it("defaults the body spacing to space-y-3 and lets it be overridden", () => {
    const { rerender } = render(<AdminSection icon={Icon} title="A"><span>x</span></AdminSection>);
    expect(document.querySelector(".bg-card")?.className).toContain("space-y-3");
    rerender(<AdminSection icon={Icon} title="A" bodyClassName="space-y-4"><span>x</span></AdminSection>);
    expect(document.querySelector(".bg-card")?.className).toContain("space-y-4");
    expect(document.querySelector(".bg-card")?.className).not.toContain("space-y-3");
  });
});
