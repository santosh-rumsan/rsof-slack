import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SlackSyncService } from './slack-sync.service';
import { UserMappingSyncService } from './user-mapping-sync.service';

@Injectable()
export class SchedulerJobsService {
  private readonly logger = new Logger(SchedulerJobsService.name);
  private jobNextRuns = new Map<string, Date>();

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

    this.addJob('user_sync', userSyncMs, () => this.slackSync.syncSlackUsers());
    this.addJob('presence_reconcile', presenceMs, () =>
      this.slackSync.reconcilePresence(),
    );
    this.addJob('user_mapping_sync', mappingMs, () =>
      this.userMappingSync.syncUserMappings(),
    );

    this.logger.log('Scheduled jobs registered');
  }

  private addJob(name: string, ms: number, fn: () => Promise<any>): void {
    this.jobNextRuns.set(name, new Date(Date.now() + ms));
    const interval = setInterval(async () => {
      this.jobNextRuns.set(name, new Date(Date.now() + ms));
      try {
        await fn();
      } catch (e) {
        this.logger.error(`Scheduled job ${name} failed: ${e.message}`);
      }
    }, ms);
    this.schedulerRegistry.addInterval(name, interval);
  }

  getJobStatus(): { job_id: string; last_run: null; next_run: string | null }[] {
    return Array.from(this.jobNextRuns.entries()).map(([job_id, next_run]) => ({
      job_id,
      last_run: null,
      next_run: next_run.toISOString(),
    }));
  }
}
