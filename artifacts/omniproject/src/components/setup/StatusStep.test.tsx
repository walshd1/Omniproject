import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../../test/utils";
import { StatusStep } from "./StatusStep";
import type { SetupStatus } from "../../lib/setup";

const baseStatus: SetupStatus = {
  configured: true,
  role: "admin",
  broker: { configured: true, urlSet: true },
  auth: { mode: "oidc" },
  ai: { provider: "demo" },
  capabilities: {
    mode: "n8n",
    issues: true,
    scheduling: false,
    resources: true,
    financials: false,
    portfolio: true,
    baseline: false,
    blockers: true,
    history: false,
    raid: true,
    quality: false,
    crm: false,
    service: false,
    benefits: false,
    stakeholders: false,
    raci: false,
    timeTravel: false,
  },
};

describe("StatusStep", () => {
  it("renders the heading and capability domains", () => {
    const { getByRole, getByText } = renderWithProviders(<StatusStep status={baseStatus} />);
    expect(getByRole("heading", { name: "Status" })).toBeInTheDocument();
    expect(getByText("issues")).toBeInTheDocument();
    expect(getByText("raid")).toBeInTheDocument();
    expect(getByText(/mode: n8n/)).toBeInTheDocument();
  });

  it("shows connected broker, OIDC identity and role when configured", () => {
    const { getByText } = renderWithProviders(<StatusStep status={baseStatus} />);
    expect(getByText("Connected")).toBeInTheDocument();
    expect(getByText("OIDC (SSO)")).toBeInTheDocument();
    expect(getByText("admin")).toBeInTheDocument();
  });

  it("shows demo fallbacks when unconfigured", () => {
    const status: SetupStatus = {
      ...baseStatus,
      broker: { configured: false, urlSet: false },
      auth: { mode: "demo" },
      capabilities: null,
    };
    const { getByText } = renderWithProviders(<StatusStep status={status} />);
    expect(getByText("Demo (sample data)")).toBeInTheDocument();
    expect(getByText("Demo login")).toBeInTheDocument();
    expect(getByText(/mode: —/)).toBeInTheDocument();
  });

  it("renders realtime and audit rows when present", () => {
    const status: SetupStatus = {
      ...baseStatus,
      realtime: { enabled: true, bus: "in-process" },
      audit: { level: "writes", sink: false },
    };
    const { getByText } = renderWithProviders(<StatusStep status={status} />);
    expect(getByText("Real-time:")).toBeInTheDocument();
    expect(getByText("enabled")).toBeInTheDocument();
    expect(getByText(/single replica/)).toBeInTheDocument();
    expect(getByText("Audit:")).toBeInTheDocument();
    expect(getByText("writes")).toBeInTheDocument();
    expect(getByText(/stdout only/)).toBeInTheDocument();
  });

  it("renders redis bus and audit sink variants", () => {
    const status: SetupStatus = {
      ...baseStatus,
      realtime: { enabled: false, bus: "redis" },
      audit: { level: "off", sink: true },
    };
    const { getByText } = renderWithProviders(<StatusStep status={status} />);
    expect(getByText(/disabled/)).toBeInTheDocument();
    expect(getByText(/fan-out: redis/)).toBeInTheDocument();
    expect(getByText(/logging server/)).toBeInTheDocument();
  });

  it("renders without crashing when status is undefined", () => {
    const { getByRole } = renderWithProviders(<StatusStep status={undefined} />);
    expect(getByRole("heading", { name: "Status" })).toBeInTheDocument();
  });
});
