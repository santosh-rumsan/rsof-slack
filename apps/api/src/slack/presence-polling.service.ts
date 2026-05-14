import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SlackSyncService } from './slack-sync.service';

// Slack rate limit for users.getPresence: tier 3 = 50 req/min
const MAX_CALLS_PER_MIN = 50;
const MS_PER_CALL = Math.ceil(60_000 / MAX_CALLS_PER_MIN); // 1200ms

@Injectable()
export class PresencePollingService {
  private readonly logger = new Logger(PresencePollingService.name);
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(forwardRef(() => SlackSyncService))
    private slackSync: SlackSyncService,
    private settings: SettingsService,
  ) {}

  get isPolling(): boolean {
    return this.pollInterval !== null;
  }

  startPolling(): void {
    if (this.pollInterval) return; // already polling

    const intervalMin = this.settings.getNumber('PRESENCE_RECONCILE_INTERVAL', 5);
    const intervalMs = intervalMin * 60 * 1000;

    this.logger.log(`Starting presence polling every ${intervalMin} min (RTM disconnected >10s)`);

    this.pollInterval = setInterval(() => {
      this.slackSync.reconcilePresence().catch((e) => {
        this.logger.error(`Presence poll failed: ${e.message}`);
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (!this.pollInterval) return;
    clearInterval(this.pollInterval);
    this.pollInterval = null;
    this.logger.log('Stopped presence polling (RTM reconnected)');
  }

  async reconcileOnce(): Promise<void> {
    this.logger.log('Running one-time presence reconcile after RTM reconnect');
    try {
      await this.slackSync.reconcilePresence();
    } catch (e) {
      this.logger.error(`One-time presence reconcile failed: ${e.message}`);
    }
  }

  /** Call when PRESENCE_RECONCILE_INTERVAL setting changes while polling is active */
  restartIfPolling(): void {
    if (!this.pollInterval) return;
    this.stopPolling();
    this.startPolling();
  }

  getStatus(): { polling: boolean; interval_label: string } {
    const intervalMin = this.settings.getNumber('PRESENCE_RECONCILE_INTERVAL', 5);
    return {
      polling: this.isPolling,
      interval_label: this.isPolling ? `every ${intervalMin} min` : 'off (RTM connected)',
    };
  }
}

export { MS_PER_CALL };
