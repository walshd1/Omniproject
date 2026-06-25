import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("renders the heading, copy and a link back to the dashboard", () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByText(/doesn't exist or has moved/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /back to dashboard/i });
    expect(link).toHaveAttribute("href", "/");
  });
});
