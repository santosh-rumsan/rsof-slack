import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from '../admin/admin.service';

@Injectable()
export class MeService {
  constructor(
    private prisma: PrismaService,
    private adminService: AdminService,
  ) {}

  async getSlackIdForSub(sub: string): Promise<string> {
    const mapping = await this.prisma.userMapping.findUnique({ where: { id: sub } });
    if (!mapping) {
      throw new NotFoundException('No Slack account linked to your user ID');
    }
    return mapping.slackId;
  }

  async getMe(sub: string) {
    const slackId = await this.getSlackIdForSub(sub);
    const user = await this.adminService.getUser(slackId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getPresenceHistory(sub: string, from?: Date, to?: Date) {
    const slackId = await this.getSlackIdForSub(sub);
    return this.adminService.getPresenceHistory(slackId, from, to);
  }

  async getStatusHistory(sub: string, from?: Date, to?: Date) {
    const slackId = await this.getSlackIdForSub(sub);
    return this.adminService.getStatusHistory(slackId, from, to);
  }

  async getDurationSummary(sub: string, from?: Date, to?: Date) {
    const slackId = await this.getSlackIdForSub(sub);
    return this.adminService.getDurationSummary(slackId, from, to);
  }
}
