import { Module } from '@nestjs/common';
import { RtmService } from './rtm.service';
import { SlackSyncService } from './slack-sync.service';
import { UserMappingSyncService } from './user-mapping-sync.service';
import { SchedulerJobsService } from './scheduler-jobs.service';
import { PresencePollingService } from './presence-polling.service';
import { PresencePushService } from './presence-push.service';

@Module({
  providers: [RtmService, SlackSyncService, UserMappingSyncService, SchedulerJobsService, PresencePollingService, PresencePushService],
  exports: [RtmService, SlackSyncService, UserMappingSyncService, SchedulerJobsService, PresencePollingService, PresencePushService],
})
export class SlackModule {}
