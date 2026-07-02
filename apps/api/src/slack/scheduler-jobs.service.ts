import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SettingsService } from '../settings/settings.service';
import { SlackSyncService } from './slack-sync.service';
import { UserMappingSyncService } from './user-mapping-sync.service';
import { PresencePollingService } from './presence-polling.service';
import { PresencePushService } from './presence-push.service';

interface JobMeta {
  description: string;
  intervalMs: number;
  intervalLabel: string;
  nextRun: Date;
  lastRun: Date | null;
  settingKey: string;
  fn: () => Promise<any>;
}

@Injectable()
export class SchedulerJobsService {
  private readonly logger = new Logger(SchedulerJobsService.name);
  private jobs = new Map<string, JobMeta>();

  constructor(
    private settings: SettingsService,
    private schedulerRegistry: SchedulerRegistry,
    private slackSync: SlackSyncService,
    private userMappingSync: UserMappingSyncService,
    private presencePolling: PresencePollingService,
    private presencePush: PresencePushService,
  ) {}

  start(): void {
    this.addJob(
      'user_sync',
      'USER_SYNC_INTERVAL',
      30,
      'Syncs the Slack user directory — fetches all members from the Slack API and upserts them into the local database. Deactivates users who are no longer in Slack.',
      () => this.slackSync.syncSlackUsers(),
    );
    this.addJob(
      'user_mapping_sync',
      'USER_MAPPING_SYNC_INTERVAL',
      60,
      'Fetches user-to-Slack-ID mappings from the external user management API (USER_MGMT_API_URL) and upserts them into the local user_mappings table.',
      () => this.userMappingSync.syncUserMappings(),
    );
    this.addJob(
      'presence_push',
      'PRESENCE_RECONCILE_INTERVAL',
      5,
      'Pushes a full presence snapshot for all active users to the external user management API (PRESENCE_PUSH_API_URL). Runs independently of RTM connection state; presence changes are also pushed in real time as they occur.',
      () => this.presencePush.pushSnapshot(),
    );

    this.logger.log('Scheduled jobs registered');
  }

  /** Restart a job with its current interval from settings (call after settings change) */
  restartJob(jobId: string): void {
    const meta = this.jobs.get(jobId);
    if (!meta) return;

    try { this.schedulerRegistry.deleteInterval(jobId); } catch {}

    const newMs = this.settings.getNumber(meta.settingKey, 30) * 60 * 1000;
    meta.intervalMs = newMs;
    meta.intervalLabel = formatInterval(newMs);
    meta.nextRun = new Date(Date.now() + newMs);

    const interval = setInterval(async () => {
      const m = this.jobs.get(jobId)!;
      m.nextRun = new Date(Date.now() + m.intervalMs);
      m.lastRun = new Date();
      try {
        await m.fn();
      } catch (e) {
        this.logger.error(`Scheduled job ${jobId} failed: ${e.message}`);
      }
    }, newMs);
    this.schedulerRegistry.addInterval(jobId, interval);

    this.logger.log(`Restarted job ${jobId} with interval ${meta.intervalLabel}`);
  }

  private addJob(
    name: string,
    settingKey: string,
    defaultMinutes: number,
    description: string,
    fn: () => Promise<any>,
  ): void {
    const ms = this.settings.getNumber(settingKey, defaultMinutes) * 60 * 1000;
    const intervalLabel = formatInterval(ms);

    const meta: JobMeta = {
      description,
      intervalMs: ms,
      intervalLabel,
      nextRun: new Date(Date.now() + ms),
      lastRun: null,
      settingKey,
      fn,
    };
    this.jobs.set(name, meta);

    const interval = setInterval(async () => {
      const m = this.jobs.get(name)!;
      m.nextRun = new Date(Date.now() + m.intervalMs);
      m.lastRun = new Date();
      try {
        await fn();
      } catch (e) {
        this.logger.error(`Scheduled job ${name} failed: ${e.message}`);
      }
    }, ms);
    this.schedulerRegistry.addInterval(name, interval);
  }

  getJobStatus(): {
    job_id: string;
    description: string;
    interval_label: string;
    interval_ms: number;
    last_run: string | null;
    next_run: string | null;
  }[] {
    const jobs = Array.from(this.jobs.entries()).map(([job_id, meta]) => ({
      job_id,
      description: meta.description,
      interval_label: meta.intervalLabel,
      interval_ms: meta.intervalMs,
      last_run: meta.lastRun?.toISOString() ?? null,
      next_run: meta.nextRun.toISOString(),
    }));

    // Add presence reconciliation as a synthetic entry (driven by RTM state)
    const pollingStatus = this.presencePolling.getStatus();
    jobs.push({
      job_id: 'presence_reconcile',
      description:
        'Polls the Slack API for presence when RTM is disconnected for >10s. Rate-limited to 50 req/min. Runs once on RTM reconnect to fill gaps.',
      interval_label: pollingStatus.interval_label,
      interval_ms: this.settings.getNumber('PRESENCE_RECONCILE_INTERVAL', 5) * 60 * 1000,
      last_run: null,
      next_run: null,
    });

    return jobs;
  }
}

function formatInterval(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `every ${minutes} min`;
  const hours = (minutes / 60).toFixed(1).replace(/\.0$/, '');
  return `every ${hours}h`;
}
