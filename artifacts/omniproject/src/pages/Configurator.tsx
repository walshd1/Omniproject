import { useState } from "react";
import { useSetupStatus } from "../lib/setup";
import { useAuth, roleAtLeast, isPmoOrAdmin } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useConfiguratorMode, ConfiguratorModeProvider } from "../lib/configurator-mode";
import { LoadingState } from "../components/LoadingState";
import { DataState } from "../components/DataState";
import { ProfileStep } from "../components/setup/ProfileStep";
import { SettingsPresetPicker } from "../components/settings/SettingsPresetPicker";
import { IdpStep } from "../components/setup/IdpStep";
import { StatusStep } from "../components/setup/StatusStep";
import { ConnectStep } from "../components/setup/ConnectStep";
import { PersistStep } from "../components/setup/PersistStep";
import { GenerateStep } from "../components/setup/GenerateStep";
import { VerifyStep } from "../components/setup/VerifyStep";
import { BackupStep } from "../components/setup/BackupStep";
import { EnvironmentsStep } from "../components/setup/EnvironmentsStep";
import { GovernanceStep } from "../components/setup/GovernanceStep";
import { FieldSetupStep } from "../components/setup/FieldSetupStep";
import { SelfHostDbStep } from "../components/setup/SelfHostDbStep";

export function Configurator() {
  const { t } = useT();
  const { data: auth, isLoading: authLoading } = useAuth();
  const allowed = isPmoOrAdmin(auth?.role);
  // The gateway route carries live broker/backend/licensing state and is gated to
  // PMO/admin there too — only fire it once the session is known to qualify, so a
  // restricted role never even reaches the internal call (it'd just 403).
  const { data: status, isLoading, isError, error, refetch } = useSetupStatus({ enabled: allowed });
  const [mode, setMode] = useConfiguratorMode();
  // Guided mode starts collapsed to the 3 essential steps; Technical mode always
  // shows everything. The toggle only matters in Guided mode.
  const [showRest, setShowRest] = useState(false);

  // The webhook URL is shared between the connect step (where it's tested and
  // applied) and the generate step (which derives the workflow path from it).
  const [url, setUrl] = useState("");
  // Which tool the user picked in the Connect step's backend picker — carried down to
  // Generate so nobody has to pick it twice.
  const [backendId, setBackendId] = useState("");

  const isAdmin = roleAtLeast(status?.role, "admin");
  const guided = mode === "guided";
  const showAdvanced = !guided || showRest;

  if (authLoading) return <LoadingState className="p-8 text-center" />;

  // Hard view gate, mirroring the nav's `visibleToRoles` — this page reads live
  // broker/backend state, so it's restricted to PMO/admin even if a plain role
  // navigates here directly (nav hides the link, but that's not enforcement).
  if (!allowed) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div role="alert" className="max-w-md w-full border-2 border-border bg-card p-8 text-center space-y-3">
          <div className="text-sm font-black uppercase tracking-widest text-muted-foreground">
            Access restricted
          </div>
          <p className="text-sm text-muted-foreground">
            The Configurator is available to <strong className="text-foreground">PMO</strong> and{" "}
            <strong className="text-foreground">Admin</strong> roles only. Ask an admin or PMO on your
            team if you need a backend connected or reconfigured.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) return <LoadingState className="p-8 text-center" />;
  if (isError) return <DataState isError error={error} onRetry={() => refetch()} className="p-8 min-h-[16rem]">{null}</DataState>;

  return (
    <ConfiguratorModeProvider mode={mode}>
      <div className="h-full overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="pb-4 border-b border-border">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <h1 className="text-3xl font-black uppercase tracking-tighter">{t("nav.configurator")}</h1>
              <div className="flex border border-border" role="radiogroup" aria-label="Configurator mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={guided}
                  onClick={() => setMode("guided")}
                  className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest ${guided ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Guided
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!guided}
                  onClick={() => setMode("technical")}
                  className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest ${!guided ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Technical
                </button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Get OmniProject talking to the tools your team already uses — Jira, a spreadsheet, SAP,
              whatever it is. Nothing here can damage your existing tools (most of it only <em>reads</em>{" "}
              data until you decide otherwise).
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {guided
                ? "Guided mode: sane defaults, only what you need today, technical detail available on demand."
                : "Technical mode: everything visible, no hand-holding, all detail expanded."}
            </p>
          </div>

          {guided && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4" data-testid="setup-start-here">
              <h2 className="text-sm font-bold">You only need three things today:</h2>
              <ol className="mt-2 space-y-1 text-sm text-muted-foreground list-decimal pl-5">
                <li><strong className="text-foreground">Connect your tool</strong> (below).</li>
                <li><strong className="text-foreground">Get the connector file</strong> for it.</li>
                <li><strong className="text-foreground">Double-check it</strong> — this can't break anything.</li>
              </ol>
              <p className="mt-2 text-xs text-muted-foreground">
                Making it permanent, staff accounts, backups, sandboxes — things you'll want <em>later</em>.
              </p>
              <button
                type="button"
                onClick={() => setShowRest((v) => !v)}
                className="mt-3 text-xs font-black uppercase tracking-widest text-primary underline"
              >
                {showRest ? "Hide the rest of the setup" : "Show the rest of the setup"}
              </button>
            </div>
          )}

          <ProfileStep isAdmin={isAdmin} />
          <SettingsPresetPicker isAdmin={isAdmin} />
          {showAdvanced && isAdmin && <IdpStep />}
          {showAdvanced && <StatusStep status={status} />}
          <ConnectStep url={url} setUrl={setUrl} backendId={backendId} setBackendId={setBackendId} isAdmin={isAdmin} />
          {showAdvanced && <PersistStep brokerUrlSet={status?.broker.urlSet} />}
          <GenerateStep url={url} isAdmin={isAdmin} status={status} backendId={backendId} setBackendId={setBackendId} />
          <VerifyStep isAdmin={isAdmin} status={status} />
          <FieldSetupStep n={6} isAdmin={isAdmin} backendId={backendId} />
          {showAdvanced && <BackupStep isAdmin={isAdmin} status={status} />}
          {showAdvanced && <EnvironmentsStep isAdmin={isAdmin} />}
          {showAdvanced && <GovernanceStep isAdmin={isAdmin} />}
          {showAdvanced && isAdmin && <SelfHostDbStep n={9} isAdmin={isAdmin} />}
        </div>
      </div>
    </ConfiguratorModeProvider>
  );
}
