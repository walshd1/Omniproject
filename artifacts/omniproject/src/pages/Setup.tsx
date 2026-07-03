import { useState } from "react";
import { useSetupStatus } from "../lib/setup";
import { roleAtLeast } from "../lib/auth";
import { useT } from "../lib/i18n";
import { LoadingState } from "../components/LoadingState";
import { DataState } from "../components/DataState";
import { ProfileStep } from "../components/setup/ProfileStep";
import { IdpStep } from "../components/setup/IdpStep";
import { StatusStep } from "../components/setup/StatusStep";
import { ConnectStep } from "../components/setup/ConnectStep";
import { PersistStep } from "../components/setup/PersistStep";
import { GenerateStep } from "../components/setup/GenerateStep";
import { VerifyStep } from "../components/setup/VerifyStep";
import { BackupStep } from "../components/setup/BackupStep";
import { EnvironmentsStep } from "../components/setup/EnvironmentsStep";
import { GovernanceStep } from "../components/setup/GovernanceStep";

export function Setup() {
  const { t } = useT();
  const { data: status, isLoading, isError, error, refetch } = useSetupStatus();

  // The webhook URL is shared between the connect step (where it's tested and
  // applied) and the generate step (which derives the workflow path from it).
  const [url, setUrl] = useState("");

  const isAdmin = roleAtLeast(status?.role, "admin");

  if (isLoading) return <LoadingState className="p-8 text-center" />;
  if (isError) return <DataState isError error={error} onRetry={() => refetch()} className="p-8 min-h-[16rem]">{null}</DataState>;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">{t("nav.setup")}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Get OmniProject talking to the tools your team already uses — Jira, a spreadsheet, SAP,
            whatever it is. Work down the page in order; nothing here can damage your existing tools
            (most of it only <em>reads</em> data until you decide otherwise), and every step tells you
            exactly what to do.
          </p>
        </div>

        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4" data-testid="setup-start-here">
          <h2 className="text-sm font-bold">New here? You only need three things today:</h2>
          <ol className="mt-2 space-y-1 text-sm text-muted-foreground list-decimal pl-5">
            <li><strong className="text-foreground">Connect your tool</strong> (step 2, below).</li>
            <li><strong className="text-foreground">Get the connector file</strong> for it (step 4).</li>
            <li><strong className="text-foreground">Double-check it</strong> (step 5) — this can't break anything.</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            The rest — making it permanent, backups, sandboxes — are things you'll want <em>later</em>, not on day
            one. Come back to them once you're happy this actually helps.
          </p>
        </div>

        <ProfileStep isAdmin={isAdmin} />
        {isAdmin && <IdpStep />}
        <StatusStep status={status} />
        <ConnectStep url={url} setUrl={setUrl} isAdmin={isAdmin} />
        <PersistStep brokerUrlSet={status?.broker.urlSet} />
        <GenerateStep url={url} isAdmin={isAdmin} status={status} />
        <VerifyStep isAdmin={isAdmin} status={status} />
        <BackupStep isAdmin={isAdmin} status={status} />
        <EnvironmentsStep isAdmin={isAdmin} />
        <GovernanceStep isAdmin={isAdmin} />
      </div>
    </div>
  );
}
