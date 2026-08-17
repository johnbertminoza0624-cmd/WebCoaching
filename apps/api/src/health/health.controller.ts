import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/rbac.guard.js';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', service: '@awr/api', time: new Date().toISOString() };
  }
}
