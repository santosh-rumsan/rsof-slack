import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SlackModule } from '../slack/slack.module';

@Module({
  imports: [SlackModule],
  controllers: [HealthController],
})
export class HealthModule {}
