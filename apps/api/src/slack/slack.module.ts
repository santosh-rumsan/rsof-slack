import { Module } from '@nestjs/common';
import { RtmService } from './rtm.service';
import { SlackSyncService } from './slack-sync.service';
import { UserMappingSyncService } from './user-mapping-sync.service';
import { SchedulerJobsService } from './scheduler-jobs.service';

@Module({
  providers: [RtmService, SlackSyncService, UserMappingSyncService, SchedulerJobsService],
  exports: [RtmService, SlackSyncService, UserMappingSyncService, SchedulerJobsService],
})
export class SlackModule {}
