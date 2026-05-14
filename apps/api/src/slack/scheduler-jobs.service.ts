import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SlackSyncService } from './slack-sync.service';
import { UserMappingSyncService } from './user-mapping-sync.service';

interface JobMeta {
  description: string;
  intervalMs: number;
  intervalLabel: string;
  nextRun: Date;
  lastRun: Date | null;
}

@Injectable()
export class SchedulerJobsService {
  private readonly logger = new Logger(SchedulerJobsService.name);
  private jobs = new Map<string, JobMeta>();

  constructor(
    private config: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
    private slackSync: SlackSyncService,
    private userMappingSync: UserMappingSyncService,
  ) {}

  start(): void {
    const userSyncMs =
      this.config.get<number>('USER_SYNC_INTERVAL', 30) * 60 * 1000;
    const presenceMs =
      this.config.get<number>('PRESENCE_RECONCILE_INTERVAL', 5) * 60 * 1000;
    const mappingMs =
      this.config.get<number>('USER_MAPPING_SYNC_INTERVAL', 60) * 60 * 1000;

    this.addJob(
      'user_sync',
      userSyncMs,
      'Syncs the Slack user directory — fetches all members from the Slack API and upserts them into the local database. Deactivates users who are no longer in Slack.',
      () => this.slackSync.syncSlackUsers(),
    );
    this.addJob(
      'presence_reconcile',
      presenceMs,
      'Polls the Slack API for the current presence status of every active user and updates the database when a change is detected. Fills in gaps between RTM events.',
      () => this.slackSync.reconcilePresence(),
    );
    this.addJob(
      'user_mapping_sync',
      mappingMs,
      'Fetches user-to-Slack-ID mappings from the external user management API (USER_MGMT_API_URL) and upserts them into the local user_mappings table.',
      () => this.userMappingSync.syncUserMappings(),
    );

    this.logger.log('Scheduled jobs registered');
  }

  private addJob(name: string, ms: number, description: string, fn: () => Promise<any>): void {
    const intervalLabel = formatInterval(ms);
    this.jobs.set(name, {
      description,
      intervalMs: ms,
      intervalLabel,
      nextRun: new Date(Date.now() + ms),
      lastRun: null,
    });

    const interval = setInterval(async () => {
      const meta = this.jobs.get(name)!;
      meta.nextRun = new Date(Date.now() + ms);
      meta.lastRun = new Date();
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
    return Array.from(this.jobs.entries()).map(([job_id, meta]) => ({
      job_id,
      description: meta.description,
      interval_label: meta.intervalLabel,
      interval_ms: meta.intervalMs,
      last_run: meta.lastRun?.toISOString() ?? null,
      next_run: meta.nextRun.toISOString(),
    }));
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
