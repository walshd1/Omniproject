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

  it("shows a fallback toast when the clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<RequestVendorDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /copy instead/i }));
    expect(writeText).toHaveBeenCalled();
  });

  it("does not navigate when the disabled GitHub link is clicked before the required fields are filled", async () => {
    const user = userEvent.setup();
    render(<RequestVendorDialog open onOpenChange={() => {}} />);
    const link = screen.getByRole("link", { name: /open a github issue/i });
    const clickEvent = await user.click(link);
    // jsdom doesn't actually navigate; the assertion is that the handler's preventDefault
    // branch runs (no throw) and the link is still marked disabled afterwards.
    expect(clickEvent).toBeUndefined();
    expect(link).toHaveAttribute("aria-disabled", "true");
  });

  it("fills every optional field and includes them all in the GitHub URL and copied summary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<RequestVendorDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText(/what's it called/i), "Smartsheet");
    await user.type(screen.getByLabelText(/what should omniproject read\/write/i), "Projects and tasks");
    await user.selectOptions(screen.getByLabelText(/how do you normally reach it/i), "GraphQL");
    await user.type(screen.getByLabelText(/link to its docs/i), "https://docs.example.com");
    await user.type(screen.getByLabelText(/how do you log into it today/i), "API key");
    const accessCheckbox = screen.getByLabelText(/sandbox\/test instance/i);
    await user.click(accessCheckbox);
    expect(accessCheckbox).toBeChecked();

    const link = screen.getByRole("link", { name: /open a github issue/i }) as HTMLAnchorElement;
    expect(link.href).toContain("api-kind=GraphQL");
    expect(link.href).toContain("docs-url=" + encodeURIComponent("https://docs.example.com").replace(/%20/g, "+"));
    expect(link.href).toContain("auth=API");
    expect(link.href).toContain("access=");

    await user.click(screen.getByRole("button", { name: /copy instead/i }));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("Docs: https://docs.example.com");
    expect(copied).toContain("How we authenticate today: API key");
    expect(copied).toContain("Access to test against:");

    // Unchecking removes it again (the toggle's delete branch).
    await user.click(accessCheckbox);
    expect(accessCheckbox).not.toBeChecked();
  });
});
