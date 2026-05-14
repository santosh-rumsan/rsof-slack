import {
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RTMClient } from '@slack/rtm-api';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PresencePollingService } from './presence-polling.service';
import * as fs from 'fs';
import * as path from 'path';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const LOG_FILE = path.resolve(process.cwd(), '.logs', 'rtm-connection.log');
const DISCONNECT_GRACE_MS = 10_000; // start polling after 10s of disconnect

function appendRtmLog(event: string): void {
  const line = `${new Date().toISOString()} [RTM] ${event}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
}

@Injectable()
export class RtmService implements OnApplicationShutdown {
  private readonly logger = new Logger(RtmService.name);
  private rtm: RTMClient;
  private connected = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private events: EventsService,
    private presencePolling: PresencePollingService,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    const token = this.config.get<string>('SLACK_BOT_TOKEN');
    this.rtm = new RTMClient(token, { autoReconnect: true, useRtmConnect: true });

    this.rtm.on('connected', async () => {
      this.connected = true;
      this.logger.log('RTM WebSocket connected');
      appendRtmLog('connected');

      // Cancel the grace-period timer if RTM reconnected before 10s
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }

      // Stop polling if it was running (disconnect was >10s)
      this.presencePolling.stopPolling();

      // Always reconcile once on connect to catch missed changes
      this.presencePolling.reconcileOnce();

      try {
        await this.resubscribeAll();
      } catch (e) {
        this.logger.error('resubscribeAll failed after reconnect: ' + e.message);
      }
    });

    this.rtm.on('disconnected', () => {
      this.connected = false;
      this.logger.warn('RTM disconnected');
      appendRtmLog('disconnected');

      // Start polling after grace period if still disconnected
      if (!this.disconnectTimer) {
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (!this.connected) {
            this.presencePolling.startPolling();
          }
        }, DISCONNECT_GRACE_MS);
      }
    });

    this.rtm.on('presence_change', async (event: any) => {
      this.logger.debug(`presence_change: ${event.user} -> ${event.presence}`);
      if (event.user && event.presence) {
        try {
          await this.upsertPresenceChange(event.user, event.presence, 'rtm');
        } catch (e) {
          this.logger.error(`presence_change upsert failed: ${e.message}`);
        }
      }
    });

    this.rtm.on('user_change', async (event: any) => {
      const user = event.user || {};
      const slackId: string = user.id;
      if (!slackId) return;
      const profile = user.profile || {};
      try {
        await this.upsertStatusChange(
          slackId,
          profile.status_text || '',
          profile.status_emoji || '',
        );
      } catch (e) {
        this.logger.error(`user_change upsert failed for ${slackId}: ${e.message}`);
      }
    });

    this.rtm.start().catch((e) => {
      this.logger.error('RTM start failed: ' + e.message);
    });
  }

  async onApplicationShutdown() {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.presencePolling.stopPolling();
    if (this.rtm) {
      await this.rtm.disconnect();
    }
  }

  async subscribePresence(userIds: string[]): Promise<void> {
    if (!this.rtm || !this.connected) return;
    for (let i = 0; i < userIds.length; i += 500) {
      const chunk = userIds.slice(i, i + 500);
      await this.rtm.addOutgoingEvent(true, 'presence_sub', { ids: chunk });
      await sleep(100);
    }
  }

  private async resubscribeAll(): Promise<void> {
    const users = await this.prisma.slackUser.findMany({
      where: { isActive: true },
      select: { slackId: true },
    });
    const ids = users.map((u) => u.slackId);
    if (ids.length > 0) {
      await this.subscribePresence(ids);
      this.logger.log(`Subscribed to presence for ${ids.length} users`);
    }
  }

  private async upsertPresenceChange(
    slackId: string,
    presence: string,
    source: string,
  ): Promise<void> {
    const user = await this.prisma.slackUser.findUnique({ where: { slackId } });
    if (!user || user.currentPresence === presence) return;

    await this.prisma.$transaction([
      this.prisma.slackUser.update({
        where: { slackId },
        data: { currentPresence: presence, lastPresenceUpdate: new Date() },
      }),
      this.prisma.presenceHistory.create({
        data: { slackId, presence, source },
      }),
    ]);

    this.logger.log(
      `Presence change: ${user.displayName || user.realName || slackId} ${user.currentPresence} -> ${presence} [${source}]`,
    );

    this.events.emit({
      type: 'presence',
      slack_id: slackId,
      presence,
      source,
      real_name: user.realName,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      ts: new Date().toISOString(),
    });
  }

  async upsertStatusChange(
    slackId: string,
    statusText: string,
    statusEmoji: string,
  ): Promise<void> {
    const user = await this.prisma.slackUser.findUnique({ where: { slackId } });
    if (!user) return;

    const changed =
      user.currentStatusText !== statusText ||
      user.currentStatusEmoji !== statusEmoji;

    if (!changed) return;

    await this.prisma.$transaction([
      this.prisma.slackUser.update({
        where: { slackId },
        data: { currentStatusText: statusText, currentStatusEmoji: statusEmoji },
      }),
      this.prisma.statusHistory.create({
        data: { slackId, statusText, statusEmoji },
      }),
    ]);

    this.events.emit({
      type: 'status',
      slack_id: slackId,
      status_text: statusText || null,
      status_emoji: statusEmoji || null,
      real_name: user.realName,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      ts: new Date().toISOString(),
    });
  }
}
