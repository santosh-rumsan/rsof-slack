import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

interface PresenceUpdate {
  email: string;
  presence: string;
}

@Injectable()
export class PresencePushService {
  private readonly logger = new Logger(PresencePushService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  private async post(updates: PresenceUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const apiUrl = this.settings.get('PRESENCE_PUSH_API_URL', '');
    if (!apiUrl) {
      this.logger.debug('PRESENCE_PUSH_API_URL not set; skipping presence push');
      return;
    }

    const apiKey = this.settings.get('USER_MGMT_API_KEY', '');
    try {
      await axios.post(
        apiUrl,
        { updates },
        {
          headers: apiKey ? { 'X-Api-Key': apiKey } : {},
          timeout: 30000,
        },
      );
    } catch (e) {
      this.logger.error(`Presence push failed (${updates.length} update(s)): ${e.message}`);
    }
  }

  /** Real-time push of a single user's presence change. */
  async pushOne(email: string | null, presence: string): Promise<void> {
    if (!email) return;
    await this.post([{ email, presence }]);
  }

  /** Periodic full-snapshot push of every active user's current presence. */
  async pushSnapshot(log?: (msg: string) => void): Promise<Record<string, number>> {
    const emit = log ?? (() => {});
    const users = await this.prisma.slackUser.findMany({
      where: { isActive: true, email: { not: null }, currentPresence: { not: null } },
      select: { email: true, currentPresence: true },
    });

    const updates: PresenceUpdate[] = users.map((u) => ({
      email: u.email!,
      presence: u.currentPresence!,
    }));

    emit(`Pushing presence snapshot for ${updates.length} user(s)...`);
    await this.post(updates);
    emit(`Done: ${updates.length} pushed.`);
    return { pushed: updates.length };
  }
}
