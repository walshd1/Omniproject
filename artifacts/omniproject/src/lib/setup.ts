import { useQuery } from "@tanstack/react-query";
import type { Capabilities } from "@workspace/api-client-react";
import type { Role } from "./auth";

export interface SetupStatus {
  configured: boolean;
  role: Role;
  broker: { configured: boolean; urlSet: boolean };
  auth: { mode: "oidc" | "demo" };
  ai: { provider: string };
  realtime?: { enabled: boolean; bus: "in-process" | "redis" };
  audit?: { level: "off" | "writes" | "all"; sink: boolean };
  dev?: { statefulDemo: boolean };
  licensing?: { valid: boolean; tier: string; features: string[]; expiresInDays: number | null };
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

/** Trigger a browser download of a Blob via a transient anchor element. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
  tier?: "standard" | "enterprise";
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
  if (!res.ok) {
    const msg = await res.json().then((j) => (j as { error?: string }).error).catch(() => null);
    throw new Error(msg || `generate failed: ${res.status}`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, `omniproject-${backendId}.json`);
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

/** Download a portable JSON backup of the gateway config. */
export async function downloadSnapshot(): Promise<void> {
  const res = await fetch("/api/setup/snapshot", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`snapshot failed: ${res.status}`);
  const blob = await res.blob();
  triggerBlobDownload(blob, `omniproject-snapshot-${new Date().toISOString().slice(0, 10)}.json`);
}

export interface RestoreResult {
  restored: boolean;
  warnings?: string[];
  error?: string;
}

/** Restore gateway config from a snapshot object. */
export async function restoreSnapshot(snapshot: unknown): Promise<RestoreResult> {
  const res = await fetch("/api/setup/restore", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  const data = (await res.json().catch(() => ({}))) as RestoreResult;
  if (!res.ok) throw new Error(data.error || `restore failed: ${res.status}`);
  return data;
}

export interface ConfigVersion {
  id: string;
  env: string;
  at: string;
  label?: string;
  knownGood: boolean;
}

export interface StoreView {
  activeEnv: string;
  environments: string[];
  versions: ConfigVersion[];
  lastKnownGoodId: string | null;
  persisted: boolean;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `request failed: ${res.status}`);
  return data;
}

export async function fetchEnvironments(): Promise<StoreView> {
  const res = await fetch("/api/setup/environments", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`environments failed: ${res.status}`);
  return (await res.json()) as StoreView;
}

export const createEnvironment = (name: string) => postJson("/api/setup/environments", { name }) as Promise<StoreView>;
export const activateEnvironment = (name: string) => postJson("/api/setup/environments/activate", { name }) as Promise<StoreView>;
export const promoteEnvironment = (from: string, to: string) => postJson("/api/setup/promote", { from, to }) as Promise<StoreView>;
export const markKnownGood = (id: string) => postJson(`/api/setup/versions/${id}/known-good`, {}) as Promise<StoreView>;
export const rollback = (body: { versionId?: string; toKnownGood?: boolean }) =>
  postJson("/api/setup/rollback", body) as Promise<{ rolledBack: boolean; appliedVersion: string; store: StoreView }>;

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
