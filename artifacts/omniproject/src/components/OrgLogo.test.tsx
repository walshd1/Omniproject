import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OrgLogo } from "./OrgLogo";

/** The org logo only renders when the org has BOTH a logo AND opted to show it. */

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};
const mockIdentity = (identity: Record<string, unknown>) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ identity }), { status: 200 }));

afterEach(() => vi.restoreAllMocks());

describe("OrgLogo", () => {
  it("renders the logo when set AND showLogo is on", async () => {
    mockIdentity({ id: "org_x", name: "Acme", logo: PNG, showLogo: true });
    wrap(<OrgLogo />);
    await waitFor(() => expect(screen.getByTestId("org-logo")).toHaveAttribute("src", PNG));
    expect(screen.getByTestId("org-logo")).toHaveAttribute("alt", "Acme logo");
  });

  it("renders nothing when a logo exists but showLogo is off", async () => {
    mockIdentity({ id: "org_x", name: "Acme", logo: PNG, showLogo: false });
    wrap(<OrgLogo />);
    // Give the query a tick to settle, then assert absence.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("org-logo")).toBeNull();
  });

  it("renders nothing when showLogo is on but no logo is set", async () => {
    mockIdentity({ id: "org_x", name: "Acme", logo: "", showLogo: true });
    wrap(<OrgLogo />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("org-logo")).toBeNull();
  });
});
