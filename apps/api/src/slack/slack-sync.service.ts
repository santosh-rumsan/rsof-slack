import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { PrismaService } from '../prisma/prisma.service';
import { RtmService } from './rtm.service';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class SlackSyncService {
  private readonly logger = new Logger(SlackSyncService.name);
  private webClient: WebClient;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => RtmService))
    private rtm: RtmService,
  ) {
    this.webClient = new WebClient(this.config.get('SLACK_BOT_TOKEN'));
  }

  async syncSlackUsers(log?: (msg: string) => void): Promise<Record<string, number>> {
    const emit = log ?? (() => {});
    const allUsers: any[] = [];
    let cursor: string | undefined;

    emit('Fetching users from Slack API...');
    do {
      const resp: any = await this.webClient.users.list({ limit: 200, cursor });
      allUsers.push(...(resp.members || []));
      cursor = resp.response_metadata?.next_cursor || undefined;
      if (cursor) { emit(`Fetched ${allUsers.length} users so far, loading next page...`); await sleep(500); }
    } while (cursor);

    const realUsers = allUsers.filter(
      (u) => !u.is_bot && u.id !== 'USLACKBOT',
    );
    const slackIdsFromApi = new Set(realUsers.map((u) => u.id));

    const existing = await this.prisma.slackUser.findMany({
      select: { slackId: true, isActive: true },
    });
    const existingMap = new Map(existing.map((u) => [u.slackId, u.isActive]));

    emit(`Found ${realUsers.length} real users. Upserting to database...`);
    const newIds: string[] = [];
    let upserted = 0;

    for (const user of realUsers) {
      const profile = user.profile || {};
      const slackId: string = user.id;

      await this.prisma.slackUser.upsert({
        where: { slackId },
        create: {
          slackId,
          realName: user.real_name || profile.real_name || null,
          displayName: profile.display_name || user.name || null,
          email: profile.email || null,
          avatarUrl: profile.image_72 || null,
          isActive: !user.deleted,
        },
        update: {
          realName: user.real_name || profile.real_name || null,
          displayName: profile.display_name || user.name || null,
          email: profile.email || null,
          avatarUrl: profile.image_72 || null,
          isActive: !user.deleted,
          updatedAt: new Date(),
        },
      });

      upserted++;
      if (!existingMap.has(slackId)) newIds.push(slackId);
    }

    // Deactivate users no longer in Slack
    let deactivated = 0;
    for (const [slackId, wasActive] of existingMap) {
      if (wasActive && !slackIdsFromApi.has(slackId)) {
        await this.prisma.slackUser.update({
          where: { slackId },
          data: { isActive: false },
        });
        deactivated++;
      }
    }

    if (newIds.length > 0) {
      await this.rtm.subscribePresence(newIds);
    }

    const stats = { upserted, deactivated, new: newIds.length };
    emit(`Done: ${upserted} upserted, ${deactivated} deactivated, ${newIds.length} new.`);
    this.logger.log(`User sync complete: ${JSON.stringify(stats)}`);
    return stats;
  }

  async reconcilePresence(log?: (msg: string) => void): Promise<Record<string, number>> {
    const emit = log ?? (() => {});
    const users = await this.prisma.slackUser.findMany({
      where: { isActive: true },
      select: { slackId: true, currentPresence: true },
    });

    emit(`Reconciling presence for ${users.length} active users...`);
    let updated = 0;

    for (const user of users) {
      try {
        const resp: any = await this.webClient.users.getPresence({ user: user.slackId });
        const presence: string = resp.presence;

        if (presence && presence !== user.currentPresence) {
          const fullUser = await this.prisma.slackUser.findUnique({
            where: { slackId: user.slackId },
          });
          if (fullUser) {
            await this.prisma.$transaction([
              this.prisma.slackUser.update({
                where: { slackId: user.slackId },
                data: { currentPresence: presence, lastPresenceUpdate: new Date() },
              }),
              this.prisma.presenceHistory.create({
                data: { slackId: user.slackId, presence, source: 'poll' },
              }),
            ]);
            emit(`Updated: ${fullUser.displayName || fullUser.realName || user.slackId} → ${presence}`);
            updated++;
          }
        }
      } catch (e) {
        this.logger.warn(`Failed to fetch presence for ${user.slackId}: ${e.message}`);
      }

      // Slack tier-3 rate limit: 50 req/min → 1 req per 1200ms
      await sleep(1200);
    }

    emit(`Done: ${updated} updated of ${users.length} checked.`);
    this.logger.log(`Presence reconciliation: ${updated} updated of ${users.length}`);
    return { checked: users.length, updated };
  }
}
