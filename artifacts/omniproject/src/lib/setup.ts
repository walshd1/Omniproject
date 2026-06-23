import { useQuery } from "@tanstack/react-query";
import type { Capabilities } from "@workspace/api-client-react";
import type { Role } from "./auth";

export interface SetupStatus {
  configured: boolean;
  role: Role;
  n8n: { configured: boolean; webhookUrlSet: boolean };
  auth: { mode: "oidc" | "demo" };
  ai: { provider: string };
  capabilities: Capabilities | null;
}

export interface N8nTestResult {
  reachable: boolean;
  ok?: boolean;
  status?: number;
  implementsCapabilities?: boolean;
  capabilities?: Record<string, boolean> | null;
  error?: string;
}

export type ExportFormat = "env" | "compose" | "k8s";

async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await fetch("/api/setup/status", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`setup status failed: ${res.status}`);
  return (await res.json()) as SetupStatus;
}

/** Reactively track what's wired, for the Setup / Connection Center. */
export function useSetupStatus() {
  return useQuery({ queryKey: ["setup", "status"], queryFn: fetchSetupStatus, retry: false, staleTime: 10_000 });
}

/** Non-destructive reachability + capability probe of a candidate webhook URL. */
export async function testN8nConnection(webhookUrl: string): Promise<N8nTestResult> {
  const res = await fetch("/api/setup/test-n8n", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl }),
  });
  return (await res.json().catch(() => ({ reachable: false, error: `request failed (${res.status})` }))) as N8nTestResult;
}

/** Fetch durable config (the operator persists this in their environment). */
export async function fetchConfigExport(format: ExportFormat): Promise<string> {
  const res = await fetch(`/api/setup/export?format=${format}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  return res.text();
}
