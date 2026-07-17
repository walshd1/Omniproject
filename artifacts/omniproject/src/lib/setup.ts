import { useQuery } from "@tanstack/react-query";
import type { Capabilities } from "@workspace/api-client-react";
import type { Role } from "./auth";
import { getJson } from "./api";

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

export interface BrokerTestResult {
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
  return getJson<SetupStatus>("/api/setup/status");
}

/** Reactively track what's wired, for the Configurator. Internal: the gateway route
 *  is PMO/admin-gated, so callers outside that role must not fire this query — pass
 *  `enabled: false` (see `isPmoOrAdmin` in lib/auth) rather than let it 403. */
export function useSetupStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["setup", "status"],
    queryFn: fetchSetupStatus,
    retry: false,
    staleTime: 10_000,
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

export interface PublicSetupStatus {
  broker: { configured: boolean };
}

async function fetchPublicSetupStatus(): Promise<PublicSetupStatus> {
  return getJson<PublicSetupStatus>("/api/setup/status/public");
}

/** The outer-surface counterpart to `useSetupStatus` — the one fact every session
 *  needs regardless of role (e.g. the demo-mode banner in the global chrome). Use
 *  this instead of `useSetupStatus` for anything outside the Configurator. */
export function usePublicSetupStatus() {
  return useQuery({ queryKey: ["setup", "status", "public"], queryFn: fetchPublicSetupStatus, retry: false, staleTime: 10_000 });
}

/** Non-destructive reachability + capability probe of a candidate broker webhook URL. */
export async function testBrokerConnection(webhookUrl: string): Promise<BrokerTestResult> {
  const res = await fetch("/api/setup/test-broker", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl }),
  });
  return (await res.json().catch(() => ({ reachable: false, error: `request failed (${res.status})` }))) as BrokerTestResult;
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
  /** How confident we are this manifest matches the real, live vendor API — see
   *  `VerificationStatus` in `lib/backend-catalogue/src/backend-manifest.ts`. */
  verification?: "verified" | "catalogued" | "experimental";
  via: string;
  credentialType: string | null;
  requiredEnv: string[];
  actions: string[];
  capabilities: Record<string, boolean>;
  notes?: string;
  tier?: "standard" | "enterprise";
}

/** Internal: the Configurator's full backend catalogue (docs, required env, actions,
 *  capabilities). Gated to PMO/admin at the gateway. */
export async function fetchBackends(): Promise<BackendInfo[]> {
  return getJson<BackendInfo[]>("/api/setup/backends");
}

/** Outer surface: just the known backend ids, for non-Configurator callers (e.g.
 *  Settings' backend-source suggestion dropdown) that need to validate/suggest an
 *  id but have no business seeing the full internal manifest. */
export async function fetchBackendIds(): Promise<string[]> {
  return getJson<string[]>("/api/setup/backends/ids");
}

export interface BrokerInfo {
  id: string;
  label: string;
  docsUrl: string;
  kind: string;
  hosted: boolean;
  capabilities: { synchronous: boolean; selfHostable: boolean; managedAuth: boolean; eventsInbound: boolean; eventsOutbound: boolean };
  build: string;
  notes?: string;
  /** The pre-selected, shipped-as-default broker in the picker UI. */
  reference?: boolean;
}

/** The broker kinds OmniProject knows how to be driven by — n8n is the shipped reference. */
export async function fetchBrokers(): Promise<BrokerInfo[]> {
  return getJson<BrokerInfo[]>("/api/setup/brokers");
}

export interface OutputInfo {
  id: string;
  label: string;
  route: string;
  kind: string;
  capabilities: { readOnly: boolean; streaming: boolean; auth: string };
  /** The connection methods offered (e.g. `["api","mcp"]` for a calendar). */
  transports?: string[];
  notes?: string;
}

/** The outward interfaces that expose portfolio data/events to other systems (BI feeds, MCP, exports, …). */
export async function fetchOutputs(): Promise<OutputInfo[]> {
  return getJson<OutputInfo[]>("/api/setup/outputs");
}

export interface NotificationChannelInfo {
  id: string;
  label: string;
  docsUrl: string;
  kind: string;
  capabilities: {
    channels: boolean;
    directMessage: boolean;
    richFormatting: boolean;
    threads: boolean;
    inboundReply: boolean;
    delivery: string;
  };
  notes?: string;
}

/** The channels OmniProject can push alerts/events to (Slack, PagerDuty, email, …). */
export async function fetchNotificationChannels(): Promise<NotificationChannelInfo[]> {
  return getJson<NotificationChannelInfo[]>("/api/setup/notifications");
}

export interface ReportInfo {
  id: string;
  label: string;
  docsUrl: string;
  kind: string;
  capabilities: { requiresCapability: string | null; timeSeries: boolean; exports: string[] };
  notes?: string;
}

/** Reports this instance's governance allows — filtered further to what a connected backend actually supports via `?available=1`. */
export async function fetchReports(): Promise<ReportInfo[]> {
  return getJson<ReportInfo[]>("/api/setup/reports");
}

/** The filename a generated workflow download/toast should use — kept in one place so callers can't drift. */
export function workflowFilename(backendId: string, readOnly: boolean): string {
  return `omniproject-${backendId}${readOnly ? "-readonly" : ""}.json`;
}

/** Generate a backend workflow and trigger a browser download. `readOnly` (default true) omits every write action. */
export async function downloadWorkflow(backendId: string, webhookPath?: string, readOnly = true): Promise<void> {
  const res = await fetch("/api/setup/generate-workflow", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendId, webhookPath, readOnly }),
  });
  if (!res.ok) {
    const msg = await res.json().then((j) => (j as { error?: string }).error).catch(() => null);
    throw new Error(msg || `generate failed: ${res.status}`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, workflowFilename(backendId, readOnly));
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

/** Download the DEF-STORE export (imported defs, selection bindings/locks, def-policy, custom roles) — the
 *  backup the settings snapshot never covered. Needs a fresh step-up server-side; a 403 with
 *  code:"step_up_required" is surfaced verbatim so the caller can prompt a re-auth and retry. */
export async function downloadDefsExport(): Promise<void> {
  const res = await fetch("/api/setup/defs-export", { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.code === "step_up_required" ? "step_up_required" : (body.error || `defs export failed: ${res.status}`));
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, `omniproject-defs-export-${new Date().toISOString().slice(0, 10)}.json`);
}

export interface DefsImportResult {
  imported: boolean;
  written?: { type: string; count: number }[];
  warnings?: string[];
  skipped?: number;
  error?: string;
}

/** Reimport a def-store export bundle into THIS instance (re-validated + re-encrypted server-side). Needs a
 *  fresh step-up; a step-up requirement is surfaced as Error("step_up_required") for the caller to handle. */
export async function importDefsBundle(bundle: unknown): Promise<DefsImportResult> {
  const res = await fetch("/api/setup/defs-import", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  const data = (await res.json().catch(() => ({}))) as DefsImportResult & { code?: string };
  if (!res.ok) throw new Error(data.code === "step_up_required" ? "step_up_required" : (data.error || `defs import failed: ${res.status}`));
  return data;
}

/** Download the FULL backup (settings snapshot + def-store export) as one file. Needs a fresh step-up;
 *  a step-up requirement surfaces as Error("step_up_required").
 *  `encrypted` downloads the SEALED variant: the COMPLETE state (secrets included) sealed under this
 *  deployment's own key — restoring it elsewhere needs the same key material. The default (plaintext) variant
 *  leaves secrets out. */
export async function downloadFullBackup(encrypted = false): Promise<void> {
  const res = await fetch(`/api/setup/full-backup${encrypted ? "?encrypted=1" : ""}`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.code === "step_up_required" ? "step_up_required" : (body.error || `full backup failed: ${res.status}`));
  }
  const blob = await res.blob();
  const kind = encrypted ? "full-backup-sealed" : "full-backup";
  triggerBlobDownload(blob, `omniproject-${kind}-${new Date().toISOString().slice(0, 10)}.json`);
}

export interface FullRestoreResult {
  restored: boolean;
  settingsRestored?: boolean;
  defStore?: { written?: unknown[]; skipped?: number } | null;
  warnings?: string[];
  error?: string;
}

/** Restore BOTH settings + defs from a full backup. Needs a fresh step-up. */
export async function restoreFullBackup(backup: unknown): Promise<FullRestoreResult> {
  const res = await fetch("/api/setup/full-restore", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup),
  });
  const data = (await res.json().catch(() => ({}))) as FullRestoreResult & { code?: string };
  if (!res.ok) throw new Error(data.code === "step_up_required" ? "step_up_required" : (data.error || `full restore failed: ${res.status}`));
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

/** The `.old` config-dir backup's age — the SPA nudges the admin to clear it out once `stale`. */
export interface ConfigBackupInfo {
  present: boolean;
  ageDays: number | null;
  stale: boolean;
}

/** What the deployment config directory (OMNI_CONFIG_DIR) has loaded, plus the backup state. */
export interface ConfigDirStatus {
  dir: string | null;
  present: boolean;
  vendors: Record<string, number>;
  configApplied: boolean;
  rulesetsApplied: boolean;
  artifacts: number;
  warnings: string[];
  errors: string[];
  backup: ConfigBackupInfo;
}

export async function fetchConfigDirStatus(): Promise<ConfigDirStatus> {
  const res = await fetch("/api/setup/config-dir", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`config-dir status failed: ${res.status}`);
  return (await res.json()) as ConfigDirStatus;
}

export interface ConfigRefreshResult {
  ok: boolean;
  reverted: boolean;
  backedUp: boolean;
  summary: Omit<ConfigDirStatus, "backup">;
}

/** Hot-reload OMNI_CONFIG_DIR now (the operator has already edited the files on disk).
 *  Call behind `withStepUp` — this changes live vendor/ruleset config. */
export const refreshConfigDir = () => postJson("/api/setup/config-dir/refresh", {}) as Promise<ConfigRefreshResult>;

/** Delete the `.old` config-dir backup (the 30-day cleanup nudge's action). */
export const clearConfigDirBackup = () => postJson("/api/setup/config-dir/clear-backup", {}) as Promise<{ cleared: boolean }>;
