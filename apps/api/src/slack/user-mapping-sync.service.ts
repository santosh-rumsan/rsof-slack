import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserMappingSyncService {
  private readonly logger = new Logger(UserMappingSyncService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async syncUserMappings(): Promise<Record<string, number>> {
    const apiUrl = this.config.get<string>('USER_MGMT_API_URL', '');
    if (!apiUrl) {
      this.logger.warn('USER_MGMT_API_URL not set; skipping user mapping sync');
      return { synced: 0, skipped: 0 };
    }

    const apiKey = this.config.get<string>('USER_MGMT_API_KEY', '');
    const resp = await axios.get(apiUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeout: 30000,
    });

    const body = resp.data;
    const data: any[] = Array.isArray(body) ? body : body?.data ?? [];

    let synced = 0;
    let skipped = 0;
    const now = new Date();

    for (const item of data) {
      const internalId: string = item.user_cuid;
      const slackId: string = item.external_id;

      if (!internalId || !slackId) {
        skipped++;
        continue;
      }

      await this.prisma.userMapping.upsert({
        where: { id: internalId },
        create: { id: internalId, slackId, syncedAt: now },
        update: { slackId, syncedAt: now },
      });
      synced++;
    }

    this.logger.log(`User mapping sync: ${synced} synced, ${skipped} skipped`);
    return { synced, skipped };
  }
}
