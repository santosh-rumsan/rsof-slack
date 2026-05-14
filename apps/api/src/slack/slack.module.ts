import { Module } from '@nestjs/common';
import { RtmService } from './rtm.service';
import { SlackSyncService } from './slack-sync.service';
import { UserMappingSyncService } from './user-mapping-sync.service';
import { SchedulerJobsService } from './scheduler-jobs.service';
import { PresencePollingService } from './presence-polling.service';

@Module({
  providers: [RtmService, SlackSyncService, UserMappingSyncService, SchedulerJobsService, PresencePollingService],
  exports: [RtmService, SlackSyncService, UserMappingSyncService, SchedulerJobsService, PresencePollingService],
})
export class SlackModule {}
