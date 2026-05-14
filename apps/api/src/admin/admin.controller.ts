import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Res,
  NotFoundException,
  UseGuards,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { ApiKeyOrJwtAdminGuard } from '../auth/api-key-or-jwt-admin.guard';
import { AdminService } from './admin.service';
import { EventsService } from '../events/events.service';
import { SlackSyncService } from '../slack/slack-sync.service';
import { UserMappingSyncService } from '../slack/user-mapping-sync.service';
import { SchedulerJobsService } from '../slack/scheduler-jobs.service';
import { SettingsService } from '../settings/settings.service';
import { PresencePollingService } from '../slack/presence-polling.service';

@Controller('admin')
@UseGuards(ApiKeyOrJwtAdminGuard)
export class AdminController {
  private emojiCache: Record<string, string> | null = null;
  private emojiCacheAt = 0;
  private readonly EMOJI_TTL_MS = 60 * 60 * 1000;

  constructor(
    private admin: AdminService,
    private events: EventsService,
    private slackSync: SlackSyncService,
    private userMappingSync: UserMappingSyncService,
    private schedulerJobs: SchedulerJobsService,
    private settings: SettingsService,
    private presencePolling: PresencePollingService,
    private config: ConfigService,
  ) {}

  // ─── Settings ────────────────────────────────────────────────────────────

  @Get('settings')
  getSettings() {
    return this.settings.getAll();
  }

  @Put('settings')
  async updateSettings(@Body() body: { key: string; value: string }[]) {
    if (!Array.isArray(body)) {
      throw new Error('Body must be an array of { key, value } objects');
    }
    await this.settings.setMany(body);

    // Restart affected scheduled jobs if their interval changed
    const restartable = ['USER_SYNC_INTERVAL', 'USER_MAPPING_SYNC_INTERVAL'];
    const jobMap: Record<string, string> = {
      USER_SYNC_INTERVAL: 'user_sync',
      USER_MAPPING_SYNC_INTERVAL: 'user_mapping_sync',
    };
    for (const { key } of body) {
      if (restartable.includes(key)) {
        this.schedulerJobs.restartJob(jobMap[key]);
      }
      if (key === 'PRESENCE_RECONCILE_INTERVAL') {
        this.presencePolling.restartIfPolling();
      }
    }

    return { updated: body.length };
  }

  // ─── Emoji ───────────────────────────────────────────────────────────────

  @Get('emoji')
  async getEmoji() {
    const now = Date.now();
    if (this.emojiCache && now - this.emojiCacheAt < this.EMOJI_TTL_MS) {
      return { emoji: this.emojiCache };
    }
    const token = this.config.get<string>('SLACK_BOT_TOKEN');
    const slack = new WebClient(token);
    const res = await slack.emoji.list();
    this.emojiCache = (res.emoji as Record<string, string>) ?? {};
    this.emojiCacheAt = now;
    return { emoji: this.emojiCache };
  }

  // ─── Sync triggers ───────────────────────────────────────────────────────

  @Post('sync/slack-users')
  async triggerSlackUserSync() {
    const stats = await this.slackSync.syncSlackUsers();
    return { message: `Sync complete: ${JSON.stringify(stats)}` };
  }

  @Get('sync/slack-users/stream')
  async streamSlackUserSync(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (msg: string) => res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);
    try {
      const stats = await this.slackSync.syncSlackUsers(send);
      send(`DONE: ${JSON.stringify(stats)}`);
    } catch (e: any) {
      send(`ERROR: ${e.message}`);
    } finally {
      res.end();
    }
  }

  @Post('sync/user-mappings')
  async triggerUserMappingSync() {
    const stats = await this.userMappingSync.syncUserMappings();
    return { message: `Sync complete: ${JSON.stringify(stats)}` };
  }

  @Get('sync/user-mappings/stream')
  async streamUserMappingSync(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (msg: string) => res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);
    try {
      const stats = await this.userMappingSync.syncUserMappings(send);
      send(`DONE: ${JSON.stringify(stats)}`);
    } catch (e: any) {
      send(`ERROR: ${e.message}`);
    } finally {
      res.end();
    }
  }

  @Post('sync/presence')
  async triggerPresenceSync() {
    const stats = await this.slackSync.reconcilePresence();
    return { message: `Reconciliation complete: ${JSON.stringify(stats)}` };
  }

  @Get('sync/presence/stream')
  async streamPresenceSync(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (msg: string) => res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);
    try {
      const stats = await this.slackSync.reconcilePresence(send);
      send(`DONE: ${JSON.stringify(stats)}`);
    } catch (e: any) {
      send(`ERROR: ${e.message}`);
    } finally {
      res.end();
    }
  }

  @Get('sync/status')
  getSyncStatus() {
    return { jobs: this.schedulerJobs.getJobStatus() };
  }

  // ─── SSE ─────────────────────────────────────────────────────────────────

  @Sse('events/presence')
  presenceStream(): Observable<MessageEvent> {
    return this.events.stream() as Observable<MessageEvent>;
  }

  // ─── Users ───────────────────────────────────────────────────────────────

  @Get('users')
  listUsers(
    @Query('ids') ids?: string,
    @Query('presence') presence?: string,
    @Query('active_only') activeOnly?: string,
  ) {
    const active = activeOnly === undefined ? true : activeOnly !== 'false';
    return this.admin.listUsers({ ids, presence, activeOnly: active });
  }

  @Get('users/:slackId')
  async getUser(@Param('slackId') slackId: string) {
    const user = await this.admin.getUser(slackId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Get('users/:slackId/presence-history')
  getPresenceHistory(
    @Param('slackId') slackId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.getPresenceHistory(
      slackId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('users/:slackId/status-history')
  getStatusHistory(
    @Param('slackId') slackId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.getStatusHistory(
      slackId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('users/:slackId/duration-summary')
  getDurationSummary(
    @Param('slackId') slackId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.getDurationSummary(
      slackId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  // ─── Reports ─────────────────────────────────────────────────────────────

  @Get('reports/currently-active')
  reportCurrentlyActive() {
    return this.admin.reportCurrentlyActive();
  }

  @Get('reports/presence-summary')
  reportPresenceSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.reportPresenceSummary(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('reports/active-hours')
  reportActiveHours(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.reportActiveHours(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('reports/availability')
  async reportAvailability(@Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.admin.reportPresenceSummary(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    return rows.map((r: any) => ({
      slack_id: r.slack_id,
      real_name: r.real_name,
      display_name: r.display_name,
      availability_pct: Number(r.availability_pct),
    }));
  }

  @Get('reports/status-trends')
  reportStatusTrends(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.reportStatusTrends(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('reports/inactive-users')
  reportInactiveUsers(@Query('days') days?: string) {
    return this.admin.reportInactiveUsers(days ? parseInt(days, 10) : 7);
  }
}
