import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, type Capabilities } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { NAV_ITEMS, useVisibleNavItems } from "./nav";
import { featuresQueryKey, type FeatureStatus } from "./features";

function Probe() {
  const items = useVisibleNavItems();
  return (
    <ul>
      {items.map((i) => (
        <li key={i.href}>{i.label}</li>
      ))}
    </ul>
  );
}

function withProgramme(surface: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetCapabilitiesQueryKey(), {
    mode: "n8n",
    entities: { programme: { surface, store: surface } },
  } as unknown as Capabilities);
  return qc;
}

function withMyWorkEnabled(enabled: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(featuresQueryKey(), [
    { id: "myWork", label: "My Work / Inbox", description: "", enabled, loaded: enabled, needsRestart: false },
  ] satisfies FeatureStatus[]);
  return qc;
}

describe("NAV_ITEMS", () => {
  it("exposes the expected hrefs in order", () => {
    expect(NAV_ITEMS.map((n) => n.href)).toEqual([
      "/",
      "/my-work",
      "/dashboards",
      "/programmes",
      "/projects",
      "/reports",
      "/resources",
      "/explore",
      "/settings",
      "/setup",
    ]);
  });

  it("every item carries an i18nKey, label and icon", () => {
    for (const item of NAV_ITEMS) {
      expect(item.i18nKey).toMatch(/^nav\./);
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTypeOf("object");
      expect(item.match).toBeTypeOf("function");
    }
  });

  it("hrefs and i18nKeys are unique", () => {
    expect(new Set(NAV_ITEMS.map((n) => n.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((n) => n.i18nKey)).size).toBe(NAV_ITEMS.length);
  });

  it("dashboard matches only the exact root path", () => {
    const dash = NAV_ITEMS.find((n) => n.href === "/")!;
    expect(dash.match("/")).toBe(true);
    expect(dash.match("/projects")).toBe(false);
  });

  it("prefix items match their subroutes", () => {
    const projects = NAV_ITEMS.find((n) => n.href === "/projects")!;
    expect(projects.match("/projects")).toBe(true);
    expect(projects.match("/projects/123")).toBe(true);
    expect(projects.match("/")).toBe(false);
    expect(projects.match("/programmes")).toBe(false);
  });

  it("only some items expose a chord hint", () => {
    const chords = NAV_ITEMS.filter((n) => n.chord).map((n) => [n.href, n.chord]);
    expect(chords).toEqual([
      ["/", "G+D"],
      ["/projects", "G+P"],
      ["/reports", "G+R"],
      ["/explore", "G+E"],
      ["/settings", "G+S"],
    ]);
    expect(NAV_ITEMS.find((n) => n.href === "/programmes")!.chord).toBeUndefined();
  });
});

describe("useVisibleNavItems — entity gating", () => {
  it("hides Programmes when the backend can't surface the entity", () => {
    const { queryByText } = renderWithProviders(<Probe />, { client: withProgramme(false) });
    expect(queryByText("Programmes")).toBeNull();
    expect(queryByText("Projects")).not.toBeNull(); // ungated items stay
  });

  it("shows Programmes when the backend can surface it", () => {
    const { queryByText } = renderWithProviders(<Probe />, { client: withProgramme(true) });
    expect(queryByText("Programmes")).not.toBeNull();
  });
});

describe("useVisibleNavItems — feature gating", () => {
  it("hides My Work when the myWork feature module is disabled", () => {
    const { queryByText } = renderWithProviders(<Probe />, { client: withMyWorkEnabled(false) });
    expect(queryByText("My Work")).toBeNull();
    expect(queryByText("Projects")).not.toBeNull(); // ungated items stay
  });

  it("shows My Work when the myWork feature module is enabled", () => {
    const { queryByText } = renderWithProviders(<Probe />, { client: withMyWorkEnabled(true) });
    expect(queryByText("My Work")).not.toBeNull();
  });

  it("shows My Work by default while features are still loading", () => {
    const { queryByText } = renderWithProviders(<Probe />, { client: withProgramme(true) });
    expect(queryByText("My Work")).not.toBeNull();
  });
});
