import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/rbac.guard.js';
import type { AuthedRequest } from '../auth/jwt-auth.guard.js';
import { TemplatesService } from './templates.service.js';

/**
 * The coaching-form repository.
 *
 * Templates are account-scoped or global, and versioned: editing a published
 * template creates a new version rather than rewriting the one existing audits
 * were scored against. That rule lives in the service — these routes only
 * decide who may reach it.
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @RequirePermission('template:read')
  @Get()
  list(@Req() req: AuthedRequest, @Query('includeUnpublished') includeUnpublished?: string) {
    return this.templates.list(req.principal!, {
      includeUnpublished: includeUnpublished === 'true',
    });
  }

  /**
   * Published templates an audit can actually be scored against.
   * Used by the upload flow to build its .xlsx template.
   */
  @RequirePermission('template:read')
  @Get('selectable')
  selectable(@Req() req: AuthedRequest) {
    return this.templates.selectableFor(req.principal!.accountId);
  }

  @RequirePermission('template:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templates.findOne(id);
  }

  @RequirePermission('template:changelog:read')
  @Get(':id/changelog')
  changeLog(@Param('id') id: string) {
    return this.templates.changeLog(id);
  }

  @RequirePermission('template:manage')
  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.templates.update(req.principal!, id, body as never);
  }

  /** Forking to a new version is how a published template is changed. */
  @RequirePermission('template:create')
  @Post(':id/versions')
  createVersion(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { version: string },
  ) {
    return this.templates.createVersion(req.principal!, id, body?.version ?? '');
  }

  @RequirePermission('template:publish')
  @Post(':id/publish')
  publish(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.templates.publish(req.principal!, id);
  }

  /** Withdraw from selection. Never a delete — scored audits reference it. */
  @RequirePermission('template:archive')
  @Post(':id/archive')
  archive(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { archived?: boolean }) {
    return this.templates.setArchived(req.principal!, id, body?.archived !== false);
  }

  @RequirePermission('template:create')
  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() body: { name: string; slug: string; version: string; lineOfBusiness?: string | null; accountId?: string | null },
  ) {
    return this.templates.create(req.principal!, body);
  }
}
