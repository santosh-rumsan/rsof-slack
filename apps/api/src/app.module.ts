import {
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { existsSync } from 'fs';

import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { SlackModule } from './slack/slack.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { MeModule } from './me/me.module';
import { SettingsModule } from './settings/settings.module';

import { RtmService } from './slack/rtm.service';
import { SlackSyncService } from './slack/slack-sync.service';
import { UserMappingSyncService } from './slack/user-mapping-sync.service';
import { SchedulerJobsService } from './slack/scheduler-jobs.service';

const frontendDist = join(__dirname, '..', 'frontend', 'dist');

@Injectable()
class AppBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AppBootstrap');

  constructor(
    private readonly rtm: RtmService,
    private readonly slackSync: SlackSyncService,
    private readonly userMappingSync: UserMappingSyncService,
    private readonly schedulerJobs: SchedulerJobsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.slackSync.syncSlackUsers();
    } catch (e) {
      this.logger.warn('Initial user sync failed: ' + e.message);
    }

    try {
      await this.userMappingSync.syncUserMappings();
    } catch (e) {
      this.logger.warn('Initial user mapping sync failed: ' + e.message);
    }

    this.rtm.start();
    this.schedulerJobs.start();
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ...(existsSync(frontendDist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: frontendDist,
            exclude: ['/api/(.*)'],
          }),
        ]
      : []),
    PrismaModule,
    SettingsModule,
    EventsModule,
    SlackModule,
    HealthModule,
    AdminModule,
    MeModule,
  ],
  providers: [AppBootstrapService],
})
export class AppModule {}
