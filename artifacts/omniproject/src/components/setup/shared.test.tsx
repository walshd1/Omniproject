import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../../test/utils";
import { CAP_DOMAINS, Dot, Step } from "./shared";

describe("setup/shared", () => {
  it("exposes the capability domains", () => {
    expect(CAP_DOMAINS).toContain("issues");
    expect(CAP_DOMAINS).toContain("raid");
    expect(CAP_DOMAINS).toHaveLength(9);
  });

  it("Dot renders an 'unknown' icon when on is undefined", () => {
    const { getByLabelText } = renderWithProviders(<Dot on={undefined} />);
    expect(getByLabelText("unknown")).toBeInTheDocument();
  });

  it("Dot renders an 'available' icon when on is true", () => {
    const { getByLabelText } = renderWithProviders(<Dot on={true} />);
    expect(getByLabelText("available")).toBeInTheDocument();
  });

  it("Dot renders an 'unavailable' icon when on is false", () => {
    const { getByLabelText } = renderWithProviders(<Dot on={false} />);
    expect(getByLabelText("unavailable")).toBeInTheDocument();
  });

  it("Step renders its number, title and children", () => {
    const { getByText, getByRole } = renderWithProviders(
      <Step n={3} title="My Title">
        <span>child content</span>
      </Step>,
    );
    expect(getByRole("heading", { name: "My Title" })).toBeInTheDocument();
    expect(getByText("3")).toBeInTheDocument();
    expect(getByText("child content")).toBeInTheDocument();
  });
});
