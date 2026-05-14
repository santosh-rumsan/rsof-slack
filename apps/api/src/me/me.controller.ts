import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(JwtGuard)
export class MeController {
  constructor(private me: MeService) {}

  @Get()
  getMe(@Req() req: any) {
    return this.me.getMe(req.jwtPayload.sub);
  }

  @Get('presence-history')
  getPresenceHistory(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.me.getPresenceHistory(
      req.jwtPayload.sub,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('status-history')
  getStatusHistory(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.me.getStatusHistory(
      req.jwtPayload.sub,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('duration-summary')
  getDurationSummary(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.me.getDurationSummary(
      req.jwtPayload.sub,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}
