import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ─── Users ───────────────────────────────────────────────────────────────

  async listUsers(opts: {
    ids?: string;
    presence?: string;
    activeOnly?: boolean;
  }) {
    const where: Prisma.SlackUserWhereInput = {};
    if (opts.activeOnly !== false) where.isActive = true;
    if (opts.ids) {
      const idList = opts.ids.split(',').map((s) => s.trim()).filter(Boolean);
      where.slackId = { in: idList };
    }
    if (opts.presence) where.currentPresence = opts.presence;

    const users = await this.prisma.slackUser.findMany({
      where,
      orderBy: { realName: 'asc' },
    });
    return users.map(mapUser);
  }

  async getUser(slackId: string) {
    const user = await this.prisma.slackUser.findUnique({ where: { slackId } });
    return user ? mapUser(user) : null;
  }

  async getPresenceHistory(slackId: string, from?: Date, to?: Date) {
    const where: Prisma.PresenceHistoryWhereInput = { slackId };
    if (from) where.recordedAt = { ...((where.recordedAt as any) || {}), gte: from };
    if (to) where.recordedAt = { ...((where.recordedAt as any) || {}), lte: to };

    const rows = await this.prisma.presenceHistory.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: Number(r.id),
      slack_id: r.slackId,
      presence: r.presence,
      source: r.source,
      recorded_at: r.recordedAt,
    }));
  }

  async getStatusHistory(slackId: string, from?: Date, to?: Date) {
    const where: Prisma.StatusHistoryWhereInput = { slackId };
    if (from) where.recordedAt = { ...((where.recordedAt as any) || {}), gte: from };
    if (to) where.recordedAt = { ...((where.recordedAt as any) || {}), lte: to };

    const rows = await this.prisma.statusHistory.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: Number(r.id),
      slack_id: r.slackId,
      status_text: r.statusText,
      status_emoji: r.statusEmoji,
      recorded_at: r.recordedAt,
    }));
  }

  async getDurationSummary(slackId: string, from?: Date, to?: Date) {
    const fromClause = from ? Prisma.sql`AND recorded_at >= ${from}` : Prisma.sql``;
    const toClause = to ? Prisma.sql`AND recorded_at <= ${to}` : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<
      { presence: string; total_seconds: number }[]
    >(Prisma.sql`
      WITH ordered AS (
        SELECT
          presence,
          recorded_at,
          LEAD(recorded_at) OVER (ORDER BY recorded_at) AS next_at
        FROM presence_history
        WHERE slack_id = ${slackId}
        ${fromClause}
        ${toClause}
      )
      SELECT
        presence,
        SUM(EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - recorded_at))) AS total_seconds
      FROM ordered
      GROUP BY presence
    `);

    return {
      slack_id: slackId,
      from_dt: from ?? null,
      to_dt: to ?? null,
      durations: rows.map((r) => ({
        presence: r.presence,
        total_seconds: Number(r.total_seconds),
      })),
    };
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  async reportCurrentlyActive() {
    const users = await this.prisma.slackUser.findMany({
      where: { currentPresence: 'active', isActive: true },
    });
    return { count: users.length, users: users.map(mapUser) };
  }

  async reportPresenceSummary(from?: Date, to?: Date) {
    const fromClause = from ? Prisma.sql`AND recorded_at >= ${from}` : Prisma.sql``;
    const toClause = to ? Prisma.sql`AND recorded_at <= ${to}` : Prisma.sql``;

    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH ordered AS (
        SELECT
          slack_id,
          presence,
          recorded_at,
          LEAD(recorded_at) OVER (PARTITION BY slack_id ORDER BY recorded_at) AS next_at
        FROM presence_history
        WHERE 1=1
        ${fromClause}
        ${toClause}
      ),
      durations AS (
        SELECT
          slack_id,
          presence,
          EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - recorded_at)) AS seconds
        FROM ordered
      ),
      agg AS (
        SELECT
          slack_id,
          SUM(CASE WHEN presence = 'active' THEN seconds ELSE 0 END) AS active_seconds,
          SUM(CASE WHEN presence = 'away' THEN seconds ELSE 0 END) AS away_seconds
        FROM durations
        GROUP BY slack_id
      )
      SELECT
        a.slack_id,
        u.real_name,
        u.display_name,
        a.active_seconds,
        a.away_seconds,
        CASE WHEN (a.active_seconds + a.away_seconds) > 0
             THEN ROUND((a.active_seconds / (a.active_seconds + a.away_seconds) * 100)::numeric, 2)
             ELSE 0 END AS availability_pct
      FROM agg a
      JOIN slack_users u ON u.slack_id = a.slack_id
      ORDER BY availability_pct DESC
    `);
  }

  async reportActiveHours(from?: Date, to?: Date) {
    const fromClause = from ? Prisma.sql`AND recorded_at >= ${from}` : Prisma.sql``;
    const toClause = to ? Prisma.sql`AND recorded_at <= ${to}` : Prisma.sql``;

    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        EXTRACT(ISODOW FROM recorded_at)::int - 1 AS day_of_week,
        EXTRACT(HOUR FROM recorded_at)::int AS hour_of_day,
        COUNT(*) AS count
      FROM presence_history
      WHERE presence = 'active'
      ${fromClause}
      ${toClause}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
  }

  async reportStatusTrends(from?: Date, to?: Date, limit = 20) {
    const fromClause = from ? Prisma.sql`AND recorded_at >= ${from}` : Prisma.sql``;
    const toClause = to ? Prisma.sql`AND recorded_at <= ${to}` : Prisma.sql``;

    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT status_text, status_emoji, COUNT(*) AS count
      FROM status_history
      WHERE (status_text IS NOT NULL OR status_emoji IS NOT NULL)
      ${fromClause}
      ${toClause}
      GROUP BY status_text, status_emoji
      ORDER BY count DESC
      LIMIT ${limit}
    `);
  }

  async reportInactiveUsers(days = 7) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT slack_id, real_name, display_name, last_presence_update
      FROM slack_users
      WHERE is_active = true
        AND (
          last_presence_update IS NULL
          OR last_presence_update < ${cutoff}
          OR current_presence = 'away'
        )
      ORDER BY last_presence_update ASC NULLS FIRST
    `);
  }
}

// ─── Mapper ────────────────────────────────────────────────────────────────

function mapUser(u: any) {
  return {
    slack_id: u.slackId,
    real_name: u.realName,
    display_name: u.displayName,
    email: u.email,
    avatar_url: u.avatarUrl,
    is_active: u.isActive,
    current_presence: u.currentPresence,
    current_status_text: u.currentStatusText,
    current_status_emoji: u.currentStatusEmoji,
    last_presence_update: u.lastPresenceUpdate,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  };
}
