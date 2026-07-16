import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, type Capabilities } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import {
  NAV_ITEMS,
  useVisibleNavItems,
  navGroupOf,
  roleSeesAdminByDefault,
  partitionNavByGroup,
  navShelvesForRole,
  catalogueScreenNavItems,
} from "./nav";
import { featuresQueryKey, type FeatureStatus } from "./features";
import type { Role } from "./auth";

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
    { id: "myWork", kind: "module", label: "My Work / Inbox", description: "", enabled, loaded: enabled, needsRestart: false },
  ] satisfies FeatureStatus[]);
  return qc;
}

function withRole(role: Role | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  return qc;
}

describe("NAV_ITEMS", () => {
  it("exposes the expected hrefs in order", () => {
    expect(NAV_ITEMS.map((n) => n.href)).toEqual([
      "/",
      "/my-work",
      "/tasks",
      "/dashboards",
      "/content",
      "/wiki",
      "/whiteboards",
      "/proofs",
      "/goals",
      "/programmes",
      "/projects",
      "/budgets",
      "/invoices",
      "/reports",
      "/resources",
      "/resource-planning",
      "/explore",
      "/settings",
      "/configurator",
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
      ["/configurator", "G+C"],
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

describe("useVisibleNavItems — role gating (hard gate)", () => {
  const cases: Array<[Role | undefined, boolean]> = [
    ["admin", true],
    ["pmo", true],
    ["manager", false],
    ["contributor", false],
    ["viewer", false],
    [undefined, false],
  ];
  for (const [role, expected] of cases) {
    it(`${role ?? "unauthenticated"} → ${expected ? "sees" : "never sees"} the Configurator`, () => {
      const { queryByText } = renderWithProviders(<Probe />, { client: withRole(role) });
      expect(queryByText("Configurator") !== null).toBe(expected);
    });
  }

  it("ungated items stay visible regardless of role", () => {
    const { queryByText } = renderWithProviders(<Probe />, { client: withRole("viewer") });
    expect(queryByText("Projects")).not.toBeNull();
  });
});

describe("nav grouping — progressive disclosure", () => {
  const ADMIN_HREFS = ["/explore", "/settings", "/configurator"];
  const PRIMARY_HREFS = ["/", "/my-work", "/tasks", "/dashboards", "/content", "/wiki", "/whiteboards", "/proofs", "/goals", "/programmes", "/projects", "/budgets", "/invoices", "/reports", "/resources", "/resource-planning"];

  it("classifies the everyday surfaces as primary and the governance/config surfaces as admin", () => {
    for (const item of NAV_ITEMS) {
      const expected = ADMIN_HREFS.includes(item.href) ? "admin" : "primary";
      expect(navGroupOf(item)).toBe(expected);
    }
  });

  it("partitionNavByGroup splits into the two shelves preserving order", () => {
    const { primary, admin } = partitionNavByGroup(NAV_ITEMS);
    expect(primary.map((i) => i.href)).toEqual(PRIMARY_HREFS);
    expect(admin.map((i) => i.href)).toEqual(ADMIN_HREFS);
  });
});

describe("catalogueScreenNavItems — methodology-gated catalogue screens", () => {
  it("includes a catalogue screen under an uncurated composition", () => {
    const hrefs = catalogueScreenNavItems(null).map((i) => i.href);
    expect(hrefs).toContain("/kanban");
  });

  it("includes a methodology-tagged catalogue screen when its methodology is selected", () => {
    const items = catalogueScreenNavItems(["screen:kanban"]);
    const kanban = items.find((i) => i.href === "/kanban");
    expect(kanban).toBeTruthy();
    expect(kanban!.label).toBe("Kanban");
  });

  it("hides a methodology-tagged catalogue screen when a different methodology is selected", () => {
    const hrefs = catalogueScreenNavItems(["screen:something-else"]).map((i) => i.href);
    expect(hrefs).not.toContain("/kanban");
  });
});

describe("roleSeesAdminByDefault — per role", () => {
  const cases: Array<[Role | undefined, boolean]> = [
    ["admin", true],
    ["pmo", true],
    ["manager", false],
    ["contributor", false],
    ["viewer", false],
    [undefined, false],
  ];
  for (const [role, expected] of cases) {
    it(`${role ?? "unauthenticated"} → ${expected ? "sees" : "hides"} Advanced by default`, () => {
      expect(roleSeesAdminByDefault(role)).toBe(expected);
    });
  }
});

describe("navShelvesForRole — visibility per role", () => {
  it("primary shelf is always present regardless of role or toggle", () => {
    for (const role of ["admin", "pmo", "manager", "contributor", "viewer", undefined] as Array<Role | undefined>) {
      const { primary } = navShelvesForRole(NAV_ITEMS, role, false);
      expect(primary.map((i) => i.href)).toContain("/projects");
      expect(primary.map((i) => i.href)).toContain("/reports");
      // Admin surfaces never leak into the primary shelf.
      expect(primary.map((i) => i.href)).not.toContain("/settings");
    }
  });

  it("admin/PMO see the Advanced shelf even when the toggle is collapsed", () => {
    expect(navShelvesForRole(NAV_ITEMS, "admin", false).adminVisible).toBe(true);
    expect(navShelvesForRole(NAV_ITEMS, "pmo", false).adminVisible).toBe(true);
  });

  it("plain roles keep the Advanced shelf hidden until they expand it", () => {
    for (const role of ["manager", "contributor", "viewer", undefined] as Array<Role | undefined>) {
      expect(navShelvesForRole(NAV_ITEMS, role, false).adminVisible).toBe(false);
      // …but the toggle reveals it — capability is never removed, only its default visibility.
      expect(navShelvesForRole(NAV_ITEMS, role, true).adminVisible).toBe(true);
    }
  });

  it("the admin shelf still carries all governance/config routes (deep-links stay reachable)", () => {
    const { admin } = navShelvesForRole(NAV_ITEMS, "viewer", false);
    expect(admin.map((i) => i.href)).toEqual(["/explore", "/settings", "/configurator"]);
  });
});
