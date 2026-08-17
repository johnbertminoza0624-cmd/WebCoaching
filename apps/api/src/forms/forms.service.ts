import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildFormScopeFilter, canSeeRecord, canAdvanceFrom, NEXT_STAGE,
  VISIBLE_FROM_STAGE, WORKFLOW_STAGES, stageIndex,
  type Principal, type FormStage,
} from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Reads and writes of coaching forms, with authorization applied in the query
 * rather than after it.
 *
 * Two independent gates, both composed into the `where` clause:
 *
 *   1. ORG SCOPE      — `buildFormScopeFilter` — whose rows this principal owns
 *   2. VISIBILITY     — stage floor — whether the workflow has reached this role
 *
 * Filtering after the fact would still leak: total counts, pagination and
 * aggregates would all be computed over rows the user may not see.
 */

/** Column stamped when a form enters each stage. Mirrors the Prisma model. */
const STAGE_TIMESTAMP: Record<FormStage, string | null> = {
  QA_REVIEW: 'qaReviewAt',
  RELEASED_TO_OPS: 'releasedToOpsAt',
  OPS_COACHING: 'opsCoachingAt',
  RELEASED_TO_AGENT: 'releasedToAgentAt',
  AWAITING_AGENT_SIGNATURE: 'awaitingSignatureAt',
  FINALIZED: 'finalizedAt',
  VOIDED: 'voidedAt',
};

export interface ListQuery {
  stage?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The `where` every read goes through.
   *
   * Exposed so the controller cannot accidentally query without it — there is
   * no code path here that builds a form query by hand.
   */
  private accessWhere(principal: Principal, extra?: Prisma.CoachingFormWhereInput): Prisma.CoachingFormWhereInput {
    const scope = buildFormScopeFilter(principal) as Prisma.CoachingFormWhereInput;

    // Stages this role may see at all. Expressed as an explicit `in` list so
    // the database does the exclusion — not the application after loading.
    const visibleStages = ([...WORKFLOW_STAGES, 'VOIDED'] as FormStage[])
      .filter((stage) => canSeeRecord(principal.role, stage));

    return { AND: [scope, { status: { in: visibleStages as never[] } }, extra ?? {}] };
  }

  async list(principal: Principal, query: ListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    // A stage filter can only ever narrow what the principal may already see;
    // asking for a stage they cannot see returns nothing rather than erroring,
    // so the filter is not a probe for what exists.
    const extra: Prisma.CoachingFormWhereInput = query.stage
      ? { status: { in: query.stage.split(',').filter(Boolean) as never[] } }
      : {};

    const where = this.accessWhere(principal, extra);

    const [rows, total] = await Promise.all([
      this.prisma.coachingForm.findMany({
        where,
        orderBy: { auditDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          agent: { select: { id: true, firstName: true, lastName: true, eid: true } },
          supervisor: { select: { id: true, firstName: true, lastName: true } },
          auditor: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.coachingForm.count({ where }),
    ]);

    return { rows, total, page, pageSize };
  }

  /** Stage counts for the dashboards — computed over the scoped set only. */
  async stageCounts(principal: Principal) {
    const grouped = await this.prisma.coachingForm.groupBy({
      by: ['status'],
      where: this.accessWhere(principal),
      _count: true,
    });
    return Object.fromEntries(grouped.map((g) => [g.status, g._count]));
  }

  /**
   * A single form.
   *
   * Out of scope is reported as 404, never 403: "you may not see this" and
   * "this does not exist" must be indistinguishable, or the endpoint becomes a
   * way to confirm a record exists by its id.
   */
  async get(principal: Principal, id: string) {
    const form = await this.prisma.coachingForm.findFirst({
      where: this.accessWhere(principal, { id }),
      include: {
        agent: { select: { id: true, firstName: true, lastName: true, eid: true } },
        supervisor: { select: { id: true, firstName: true, lastName: true } },
        auditor: { select: { id: true, firstName: true, lastName: true } },
        parameterResults: { orderBy: { sortOrder: 'asc' } },
        holdAttempts: { orderBy: { attemptNo: 'asc' } },
        signatures: { where: { supersededAt: null, declined: false } },
        // Sections C and D. Without these the coaching form opens blank for an
        // Ops TL returning to work they already saved.
        rootCauses: { orderBy: { coachingPriority: 'asc' }, include: { gap: true } },
        actionPlan: { orderBy: { priority: 'asc' } },
      },
    });
    if (!form) throw new NotFoundException('Coaching form not found');
    return form;
  }

  /**
   * Advance a form one stage.
   *
   * Three checks, in order: the principal may see it, the principal owns the
   * stage it is currently at, and every parameter scored NO carries an
   * observation. The last is the release rule — enforced here rather than only
   * in the browser, so a crafted request cannot skip it.
   */
  async advance(principal: Principal, id: string) {
    const form = await this.prisma.coachingForm.findFirst({
      where: this.accessWhere(principal, { id }),
      include: { parameterResults: true },
    });
    if (!form) throw new NotFoundException('Coaching form not found');

    const current = form.status as FormStage;
    if (!canAdvanceFrom(principal.role, current)) {
      throw new ForbiddenException(
        `A ${principal.role} cannot advance a form at the ${current} stage.`,
      );
    }

    const next = NEXT_STAGE[current];
    if (!next) throw new BadRequestException('This form is already at a terminal stage.');

    if (current === 'QA_REVIEW') {
      const missing = form.parameterResults.filter(
        (p) => p.answer === 'NO' && !p.observedBehavior?.trim(),
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `${missing.length} parameter(s) scored "No" still need an observation: ` +
          missing.map((p) => `P${p.sortOrder}`).join(', '),
        );
      }
    }

    const stampField = STAGE_TIMESTAMP[next];
    const updated = await this.prisma.coachingForm.update({
      where: { id },
      data: {
        status: next as never,
        ...(stampField ? { [stampField]: new Date() } : {}),
        changeLog: {
          create: {
            actorId: principal.id,
            revision: form.revision,
            action: 'form.status_changed',
            field: 'status',
            oldValue: current,
            newValue: next,
          },
        },
      },
    });

    return { id: updated.id, from: current, to: updated.status };
  }

  /** The stage floor applied to this principal — surfaced for the UI to explain itself. */
  visibilityFloor(principal: Principal) {
    const floor = VISIBLE_FROM_STAGE[principal.role];
    return {
      floor,
      floorIndex: floor ? stageIndex(floor) : null,
      visibleStages: ([...WORKFLOW_STAGES, 'VOIDED'] as FormStage[])
        .filter((s) => canSeeRecord(principal.role, s)),
    };
  }
}
