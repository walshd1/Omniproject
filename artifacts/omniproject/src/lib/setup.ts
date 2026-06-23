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

export interface BackendInfo {
  id: string;
  label: string;
  docsUrl: string;
  via: string;
  credentialType: string | null;
  requiredEnv: string[];
  actions: string[];
  capabilities: Record<string, boolean>;
  notes?: string;
}

export async function fetchBackends(): Promise<BackendInfo[]> {
  const res = await fetch("/api/setup/backends", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`backends failed: ${res.status}`);
  return (await res.json()) as BackendInfo[];
}

/** Generate a backend workflow and trigger a browser download. */
export async function downloadWorkflow(backendId: string, webhookPath?: string): Promise<void> {
  const res = await fetch("/api/setup/generate-workflow", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendId, webhookPath }),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `omniproject-${backendId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface VerifyActionResult {
  action: string;
  ok: boolean;
  status: number;
  ms: number;
  verifyAware: boolean;
  message: string | null;
}

export interface VerifyResult {
  webhookUrl: string;
  summary: { passed: number; total: number; verifyAware: boolean };
  results: VerifyActionResult[];
  note: string;
}

export async function verifyWorkflow(): Promise<VerifyResult> {
  const res = await fetch("/api/setup/verify-workflow", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error || `verify failed: ${res.status}`);
  }
  return (await res.json()) as VerifyResult;
}
