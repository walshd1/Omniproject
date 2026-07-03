import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { RequestVendorDialog } from "./RequestVendorDialog";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RequestVendorDialog", () => {
  it("renders the low-tech fields (no JSON, no auth headers, no field mapping)", () => {
    render(<RequestVendorDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("heading", { name: /tell us what you use/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what's it called/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/how do you normally reach it/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what should omniproject read\/write/i)).toBeInTheDocument();
  });

  it("disables the GitHub issue link until the required fields are filled", async () => {
    const user = userEvent.setup();
    render(<RequestVendorDialog open onOpenChange={() => {}} />);
    const link = screen.getByRole("link", { name: /open a github issue/i });
    expect(link).toHaveAttribute("aria-disabled", "true");

    await user.type(screen.getByLabelText(/what's it called/i), "Smartsheet");
    await user.type(screen.getByLabelText(/what should omniproject read\/write/i), "Projects and tasks");
    expect(link).toHaveAttribute("aria-disabled", "false");
  });

  it("builds a GitHub issue URL prefilled from the connector_request.yml fields", async () => {
    const user = userEvent.setup();
    render(<RequestVendorDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText(/what's it called/i), "Smartsheet");
    await user.type(screen.getByLabelText(/what should omniproject read\/write/i), "Projects and tasks");
    const link = screen.getByRole("link", { name: /open a github issue/i }) as HTMLAnchorElement;
    expect(link.href).toContain("template=connector_request.yml");
    expect(link.href).toContain("system=Smartsheet");
    expect(link.href).toContain("capabilities=Projects");
  });

  it("copies a plain-text summary instead", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<RequestVendorDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText(/what's it called/i), "Smartsheet");
    await user.click(screen.getByRole("button", { name: /copy instead/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Smartsheet"));
  });
});
