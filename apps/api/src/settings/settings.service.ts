import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// Keys that are not exposed via the public /settings endpoint
const SENSITIVE_KEYS = new Set(['API_KEY', 'USER_MGMT_API_KEY', 'SLACK_BOT_TOKEN']);

// Default values seeded from env on first run (DB wins at runtime)
const ENV_KEYS: { key: string; envKey: string; defaultValue: string }[] = [
  { key: 'USER_MGMT_API_URL',          envKey: 'USER_MGMT_API_URL',          defaultValue: 'https://rsoffice-users-api.rumsan.xyz/users/external/slack' },
  { key: 'USER_MGMT_API_KEY',          envKey: 'USER_MGMT_API_KEY',          defaultValue: '0x333a22cb63ab89b97221460862a9a980910' },
  { key: 'PRESENCE_PUSH_API_URL',      envKey: 'PRESENCE_PUSH_API_URL',      defaultValue: 'https://rsoffice-users-api.rumsan.xyz/presence' },
  { key: 'USER_SYNC_INTERVAL',         envKey: 'USER_SYNC_INTERVAL',         defaultValue: '30' },
  { key: 'PRESENCE_RECONCILE_INTERVAL',envKey: 'PRESENCE_RECONCILE_INTERVAL',defaultValue: '5' },
  { key: 'USER_MAPPING_SYNC_INTERVAL', envKey: 'USER_MAPPING_SYNC_INTERVAL', defaultValue: '60' },
  { key: 'API_KEY',                    envKey: 'API_KEY',                    defaultValue: 'change-me-to-a-strong-random-string' },
  { key: 'TIMEZONE',                   envKey: 'TIMEZONE',                   defaultValue: 'Asia/Kathmandu' },
  { key: 'AVAILABLE_TIMEZONES',        envKey: 'AVAILABLE_TIMEZONES',        defaultValue: 'Asia/Kathmandu' },
  { key: 'WORK_START_HOUR',            envKey: 'VITE_WORK_START_HOUR',       defaultValue: '7' },
  { key: 'WORK_END_HOUR',              envKey: 'VITE_WORK_END_HOUR',         defaultValue: '23' },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedFromEnv();
    await this.loadCache();
    this.logger.log('Settings loaded from database');
  }

  private async seedFromEnv(): Promise<void> {
    for (const { key, envKey, defaultValue } of ENV_KEYS) {
      const existing = await this.prisma.setting.findUnique({ where: { key } });
      if (existing) continue;

      const envValue = this.config.get<string>(envKey, '');
      const value = envValue || defaultValue;
      if (value) {
        await this.prisma.setting.create({ data: { key, value } });
      }
    }
  }

  private async loadCache(): Promise<void> {
    const all = await this.prisma.setting.findMany();
    for (const s of all) this.cache.set(s.key, s.value);
  }

  get(key: string, defaultValue = ''): string {
    return this.cache.get(key) ?? defaultValue;
  }

  getNumber(key: string, defaultValue: number): number {
    const v = this.cache.get(key);
    if (v === undefined) return defaultValue;
    const n = Number(v);
    return isNaN(n) ? defaultValue : n;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.cache.set(key, value);
  }

  async setMany(entries: { key: string; value: string }[]): Promise<void> {
    for (const { key, value } of entries) {
      await this.set(key, value);
    }
  }

  getAll(): { key: string; value: string }[] {
    return Array.from(this.cache.entries()).map(([key, value]) => ({ key, value }));
  }

  getPublic(): { key: string; value: string }[] {
    return this.getAll().filter(({ key }) => !SENSITIVE_KEYS.has(key));
  }
}
