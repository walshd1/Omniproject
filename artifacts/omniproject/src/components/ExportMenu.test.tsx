import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/utils";
import { ExportMenu } from "./ExportMenu";

let clickSpy: ReturnType<typeof vi.spyOn>;
const hrefs: string[] = [];

beforeEach(() => {
  hrefs.length = 0;
  // The component creates an <a>, sets href and calls .click(). Capture the href.
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    hrefs.push(this.href);
  });
});

afterEach(() => {
  clickSpy.mockRestore();
});

async function open(label?: string) {
  const user = userEvent.setup();
  renderWithProviders(<ExportMenu {...(label !== undefined ? { label } : {})} />);
  await user.click(screen.getByTestId("export-menu"));
  return user;
}

describe("ExportMenu", () => {
  it("renders the trigger with a default label", () => {
    renderWithProviders(<ExportMenu />);
    expect(screen.getByTestId("export-menu")).toHaveTextContent("Export");
  });

  it("renders a custom trigger label", () => {
    renderWithProviders(<ExportMenu label="Download data" />);
    expect(screen.getByTestId("export-menu")).toHaveTextContent("Download data");
  });

  it("opens the menu listing the workbook and dataset exports", async () => {
    await open();
    expect(await screen.findByText("Workbook (.xlsx)")).toBeInTheDocument();
    expect(screen.getByText("All issues (.csv)")).toBeInTheDocument();
    expect(screen.getByText("Projects (.csv)")).toBeInTheDocument();
    expect(screen.getByText("Activity (.csv)")).toBeInTheDocument();
  });

  it("downloads the workbook url on selection", async () => {
    const user = await open();
    await user.click(await screen.findByText("Workbook (.xlsx)"));
    expect(hrefs.some((h) => h.endsWith("/api/export.xlsx"))).toBe(true);
  });

  it("without a projectId, the issues CSV is unscoped", async () => {
    const user = await open();
    await user.click(await screen.findByText("All issues (.csv)"));
    expect(hrefs.some((h) => h.endsWith("/api/export.csv?dataset=issues"))).toBe(true);
  });

  it("offers report formats scoped to all issues without a projectId", async () => {
    const user = await open();
    expect(await screen.findByText("All issues report (.pdf)")).toBeInTheDocument();
    await user.click(screen.getByText("All issues report (.json)"));
    expect(hrefs.some((h) => h.includes("/api/export.json?dataset=issues"))).toBe(true);
  });

  it("with a projectId, the issues CSV is scoped to that project", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportMenu projectId="proj-1" />);
    await user.click(screen.getByTestId("export-menu"));
    await user.click(await screen.findByText("This project's issues (.csv)"));
    expect(hrefs.some((h) => h.includes("dataset=issues") && h.includes("projectId=proj-1"))).toBe(true);
  });

  it("with a projectId, report formats are scoped and labelled per-project", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportMenu projectId="proj-9" />);
    await user.click(screen.getByTestId("export-menu"));
    await user.click(await screen.findByText("Issues report (.md)"));
    expect(hrefs.some((h) => h.includes("/api/export.md?dataset=issues") && h.includes("projectId=proj-9"))).toBe(true);
  });

  it("encodes a projectId with special characters", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportMenu projectId="a/b c" />);
    await user.click(screen.getByTestId("export-menu"));
    await user.click(await screen.findByText("This project's issues (.csv)"));
    expect(hrefs.some((h) => h.includes("projectId=a%2Fb%20c"))).toBe(true);
  });
});
