import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SlackModule } from '../slack/slack.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SlackModule, SettingsModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
