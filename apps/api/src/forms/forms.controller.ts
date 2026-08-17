import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/rbac.guard.js';
import type { AuthedRequest } from '../auth/jwt-auth.guard.js';
import { FormsService } from './forms.service.js';
import {
  FormWriteService, type ActionItemInput, type HoldAttemptInput,
  type ObservationInput, type RootCauseInput,
} from './form-write.service.js';

/**
 * Coaching form routes.
 *
 * `@RequirePermission` answers "may this role do this kind of thing at all".
 * It deliberately does NOT scope rows — every method below goes through
 * `FormsService`, which composes the org scope and the stage-visibility floor
 * into the query itself. Both checks are required: a QA Team Lead and a QA both
 * hold `form:read`, but only one of them may read another team's forms.
 */
@Controller('forms')
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly writes: FormWriteService,
  ) {}

  @RequirePermission('form:read')
  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query('stage') stage?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.forms.list(req.principal!, {
      stage,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Stage counts for the dashboards, over the caller's scoped set only. */
  @RequirePermission('form:read')
  @Get('stage-counts')
  stageCounts(@Req() req: AuthedRequest) {
    return this.forms.stageCounts(req.principal!);
  }

  /** What this role may see, so the UI can explain an empty list honestly. */
  @RequirePermission('form:read')
  @Get('visibility')
  visibility(@Req() req: AuthedRequest) {
    return this.forms.visibilityFloor(req.principal!);
  }

  @RequirePermission('form:read')
  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.forms.get(req.principal!, id);
  }

  /**
   * Move the form to the next workflow stage.
   *
   * `form:submit` is the coarse gate; the fine-grained rule — only the role
   * that owns the *current* stage may advance it — lives in the service,
   * because it depends on the record, not just the role.
   */
  @RequirePermission('form:submit')
  @Post(':id/advance')
  advance(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.forms.advance(req.principal!, id);
  }

  // ── Writes ──────────────────────────────────────────────────────────────
  // All of these carry `form:update` as the coarse gate. Which *sections* the
  // caller may write is decided per-record by `sectionAccess`, because it
  // depends on the form's stage, not just the role.

  @RequirePermission('form:update')
  @Put(':id/observations')
  saveObservations(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { observations: ObservationInput[] },
  ) {
    return this.writes.saveObservations(req.principal!, id, body?.observations ?? []);
  }

  @RequirePermission('form:update')
  @Put(':id/hold-attempts')
  saveHoldAttempts(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { attempts: HoldAttemptInput[] },
  ) {
    return this.writes.saveHoldAttempts(req.principal!, id, body?.attempts ?? []);
  }

  /**
   * Section C is the Ops TL's authoring work, produced in the same sitting as
   * the action plan it feeds — so it is gated on `actionplan:manage`, which
   * they hold, rather than `form:update`, which is QA's and would over-grant.
   */
  @RequirePermission('actionplan:manage')
  @Put(':id/root-causes')
  saveRootCauses(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { rows: RootCauseInput[] },
  ) {
    return this.writes.saveRootCauses(req.principal!, id, body?.rows ?? []);
  }

  @RequirePermission('actionplan:manage')
  @Put(':id/action-plan')
  saveActionPlan(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { items: ActionItemInput[] },
  ) {
    return this.writes.saveActionPlan(req.principal!, id, body?.items ?? []);
  }

  /**
   * Sign the block this role owns.
   *
   * Deliberately takes no "which block" parameter: the role decides, so an
   * Ops TL cannot request the agent's signature slot.
   */
  @Post(':id/sign')
  sign(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { image: string },
  ) {
    return this.writes.sign(req.principal!, id, body?.image ?? '');
  }
}
