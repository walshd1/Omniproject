import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { ProvenanceBadge } from "./ProvenanceBadge";

describe("ProvenanceBadge", () => {
  it("renders the explicit 'sourced' provenance with its live label + title", () => {
    renderWithProviders(<ProvenanceBadge provenance="sourced" />);
    const badge = screen.getByText("LIVE · BACKEND");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "Read from the backend system of record via n8n.");
  });

  it("renders the explicit 'derived' provenance", () => {
    renderWithProviders(<ProvenanceBadge provenance="derived" />);
    expect(screen.getByText("DERIVED")).toBeInTheDocument();
  });

  it("renders the explicit 'sample' provenance", () => {
    renderWithProviders(<ProvenanceBadge provenance="sample" />);
    expect(screen.getByText("SAMPLE DATA")).toBeInTheDocument();
  });

  it("falls back to 'sample' when mode is demo", () => {
    renderWithProviders(<ProvenanceBadge mode="demo" />);
    expect(screen.getByText("SAMPLE DATA")).toBeInTheDocument();
  });

  it("falls back to 'sample' when no mode and no provenance is given", () => {
    renderWithProviders(<ProvenanceBadge />);
    expect(screen.getByText("SAMPLE DATA")).toBeInTheDocument();
  });

  it("resolves to 'sourced' for a non-demo mode", () => {
    renderWithProviders(<ProvenanceBadge mode="n8n" />);
    expect(screen.getByText("LIVE · BACKEND")).toBeInTheDocument();
  });

  it("explicit provenance wins over mode", () => {
    renderWithProviders(<ProvenanceBadge provenance="derived" mode="n8n" />);
    expect(screen.getByText("DERIVED")).toBeInTheDocument();
  });

  it("applies an extra className passed in", () => {
    renderWithProviders(<ProvenanceBadge provenance="sample" className="extra-class" />);
    expect(screen.getByText("SAMPLE DATA")).toHaveClass("extra-class");
  });
});
