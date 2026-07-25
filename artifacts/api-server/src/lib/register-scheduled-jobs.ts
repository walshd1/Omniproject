import { registerScheduledJob, registerScheduledJobProvider } from "./job-scheduler";
import { execDigestScheduledJob } from "./exec-digest";
import { proactiveDigestScheduledJob } from "./proactive-digest";
import { scheduledExportScheduledJob } from "./scheduled-export";
import { driftCanaryScheduledJob } from "./drift-canary";
import { healthWatchScheduledJob } from "./health-watch";
import { recipeScheduledJobs } from "./schedule-dispatcher";

/**
 * The composition root for scheduled work: registers every background job with the unified
 * {@link job-scheduler} exactly once. The four infra jobs are static registrations (each disabled when its
 * interval env var is 0); the automation recipes are a provider re-read fresh each tick. After this, ONE
 * heartbeat drives them all — there is no other place that starts a timer.
 *
 * Idempotent-per-boot: called once from index.ts before {@link startJobScheduler}. Each job resolves its own
 * schedule live, so nothing here needs the broker or env resolved at registration time.
 */
export function registerScheduledJobs(): void {
  registerScheduledJob(execDigestScheduledJob());
  registerScheduledJob(proactiveDigestScheduledJob());
  registerScheduledJob(scheduledExportScheduledJob());
  registerScheduledJob(driftCanaryScheduledJob());
  registerScheduledJob(healthWatchScheduledJob());
  registerScheduledJobProvider(() => recipeScheduledJobs());
}
