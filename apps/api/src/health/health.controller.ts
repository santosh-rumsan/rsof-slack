import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RtmService } from '../slack/rtm.service';

@Controller('health')
export class HealthController {
  constructor(private rtm: RtmService) {}

  @Get()
  health() {
    return {
      status: 'ok',
      rtm: this.rtm.isConnected ? 'connected' : 'disconnected',
    };
  }
}
