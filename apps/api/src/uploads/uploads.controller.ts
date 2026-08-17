import { Body, Controller, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/rbac.guard.js';
import type { AuthedRequest } from '../auth/jwt-auth.guard.js';
import { UploadsService, type UploadRow } from './uploads.service.js';

/**
 * Audit import.
 *
 * `form:create` is the gate — the same permission that says who may bring
 * audits into the system at all. Ops roles do not hold it, so an Ops TL cannot
 * create the work they are later asked to coach.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @RequirePermission('form:create')
  @Post('audits')
  importAudits(
    @Req() req: AuthedRequest,
    @Body() body: { templateId: string; rows: UploadRow[] },
  ) {
    return this.uploads.import(req.principal!, body?.templateId ?? '', body?.rows ?? []);
  }
}
