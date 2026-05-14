import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

function canonicalizeTimezone(tz: string | null): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

@Injectable()
export class UserMappingSyncService {
  private readonly logger = new Logger(UserMappingSyncService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async syncUserMappings(log?: (msg: string) => void): Promise<Record<string, number>> {
    const emit = log ?? (() => {});
    const apiUrl = this.settings.get('USER_MGMT_API_URL', '');
    if (!apiUrl) {
      emit('USER_MGMT_API_URL not set; skipping.');
      this.logger.warn('USER_MGMT_API_URL not set; skipping user mapping sync');
      return { synced: 0, skipped: 0 };
    }

    emit(`Fetching user mappings from ${apiUrl}...`);

    const apiKey = this.settings.get('USER_MGMT_API_KEY', '');
    const resp = await axios.get(apiUrl, {
      headers: apiKey ? { 'X-Api-Key': apiKey } : {},
      timeout: 30000,
    });

    const body = resp.data;
    const data: any[] = Array.isArray(body) ? body : body?.data ?? [];
    emit(`Received ${data.length} mapping records.`);

    let synced = 0;
    let skipped = 0;
    const now = new Date();

    for (const item of data) {
      const internalId: string = item.user_cuid;
      const slackId: string = item.external_id;
      const userTimezone: string | null = canonicalizeTimezone(item.user_timezone ?? null);

      if (!internalId || !slackId) {
        skipped++;
        continue;
      }

      // Skip if the Slack user doesn't exist locally yet (FK constraint)
      const exists = await this.prisma.slackUser.findUnique({
        where: { slackId },
        select: { slackId: true },
      });
      if (!exists) {
        this.logger.debug(`Skipping mapping for unknown slackId ${slackId}`);
        skipped++;
        continue;
      }

      await this.prisma.$transaction([
        this.prisma.userMapping.upsert({
          where: { id: internalId },
          create: { id: internalId, slackId, syncedAt: now },
          update: { slackId, syncedAt: now },
        }),
        ...(userTimezone
          ? [this.prisma.slackUser.update({
              where: { slackId },
              data: { timezone: userTimezone },
            })]
          : []),
      ]);
      emit(`Synced: ${internalId} → ${slackId}`);
      synced++;
    }

    emit(`Done: ${synced} synced, ${skipped} skipped.`);
    this.logger.log(`User mapping sync: ${synced} synced, ${skipped} skipped`);
    return { synced, skipped };
  }
}
