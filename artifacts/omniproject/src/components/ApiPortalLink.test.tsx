import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { ApiPortalLink } from "./ApiPortalLink";

/**
 * The API-portal link renders ONLY when /api/discovery advertises a `docs` URL (i.e. an operator
 * enabled the portal). Otherwise it renders nothing — it can never point at a disabled 404.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

describe("ApiPortalLink", () => {
  it("renders a link when discovery advertises the portal (portal enabled)", async () => {
    fetchMock.mockResolvedValue(jsonRes({ docs: "https://omni.example.com/api/docs" }));
    renderWithProviders(<ApiPortalLink />);
    await waitFor(() => expect(screen.getByTestId("api-portal-link")).toBeInTheDocument());
    const a = screen.getByTestId("api-portal-link");
    expect(a).toHaveAttribute("href", "https://omni.example.com/api/docs");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders nothing when the portal is off (no docs field in discovery)", async () => {
    fetchMock.mockResolvedValue(jsonRes({ openapi: { url: "/api/openapi.yaml" } }));
    const { container } = renderWithProviders(<ApiPortalLink />);
    // Give the query a tick; the link must never appear.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("api-portal-link")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
