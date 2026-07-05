import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerificationBadge } from "./VerificationBadge";

describe("VerificationBadge", () => {
  it("renders the VERIFIED label with its tooltip", () => {
    render(<VerificationBadge verification="verified" />);
    const badge = screen.getByText("VERIFIED");
    expect(badge).toHaveAttribute("title", expect.stringMatching(/live instance/i));
  });

  it("renders the EXPERIMENTAL label with its tooltip", () => {
    render(<VerificationBadge verification="experimental" />);
    const badge = screen.getByText("EXPERIMENTAL");
    expect(badge).toHaveAttribute("title", expect.stringMatching(/speculative|partial/i));
  });

  it("renders CATALOGUED for an explicit catalogued value", () => {
    render(<VerificationBadge verification="catalogued" />);
    expect(screen.getByText("CATALOGUED")).toBeInTheDocument();
  });

  it("defaults to CATALOGUED when verification is omitted, rather than crashing", () => {
    render(<VerificationBadge />);
    expect(screen.getByText("CATALOGUED")).toBeInTheDocument();
  });

  it("defaults to CATALOGUED for an unrecognised value instead of throwing", () => {
    render(<VerificationBadge verification={"bogus" as never} />);
    expect(screen.getByText("CATALOGUED")).toBeInTheDocument();
  });
});
