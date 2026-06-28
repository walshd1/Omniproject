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
            Wire OmniProject to your n8n + backend. OmniProject stays stateless — this wizard applies settings for the
            current session and emits durable config for you to keep in your environment.
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
      </div>
    </div>
  );
}
