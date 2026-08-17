import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { can, sectionAccess, type CoachingSection, type FormStage, type Principal } from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { FormsService } from './forms.service.js';

/**
 * Writes to a coaching form.
 *
 * Every method asks the *same* question the browser asks before rendering a
 * field: `sectionAccess(role, stage, section)`. That shared function is the
 * point — the UI uses it to decide what to show, the API uses it to decide what
 * to accept, and neither can drift from the other. A crafted request that skips
 * the UI hits exactly the rule the UI was displaying.
 */

export interface ObservationInput {
  sortOrder: number;
  observedBehavior: string | null;
}

export interface HoldAttemptInput {
  attemptNo: number;
  reason?: string | null;
  durationSeconds?: number;
  reasonValid?: 'YES' | 'NO' | 'NA';
}

export interface RootCauseInput {
  /** Parameter this row explains, when it maps to one. */
  sortOrder?: number | null;
  situation?: string | null;
  behavior?: string | null;
  /** Accepts the short form the UI uses; mapped to `ImpactType` below. */
  impact?: 'CUSTOMER' | 'PROCESS' | 'BUSINESS' | 'COMPLIANCE' | 'NONE';
  priority?: number | null;
  gap?: string | null;
}

/** The UI speaks in critical-error categories; the schema in impact types. */
const IMPACT: Record<string, string> = {
  CUSTOMER: 'CUSTOMER_IMPACTING',
  PROCESS: 'PROCESS_DEFECT',
  BUSINESS: 'BUSINESS_IMPACTING',
  COMPLIANCE: 'COMPLIANCE_IMPACTING',
  NONE: 'NO_IMPACT',
};

export interface ActionItemInput {
  priority: number;
  activity?: string | null;
  deadline?: string | null;
  successMeasure?: string | null;
  goal?: string | null;
}

@Injectable()
export class FormWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
  ) {}

  /**
   * Loads a form the principal may see and checks they may edit `section` at
   * its current stage. Returns the form so callers do not re-query.
   */
  private async authorize(principal: Principal, id: string, section: CoachingSection) {
    // `get` already applies scope + visibility; out of scope surfaces as 404.
    const form = await this.prisma.coachingForm.findFirst({
      where: { id },
      include: { parameterResults: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!form) throw new NotFoundException('Coaching form not found');

    // Re-run the scoped read so an out-of-scope id is indistinguishable from a
    // missing one, rather than leaking existence through a 403.
    await this.forms.get(principal, id).catch(() => {
      throw new NotFoundException('Coaching form not found');
    });

    const access = sectionAccess(principal.role, form.status as FormStage, section);
    if (access !== 'EDIT') {
      throw new ForbiddenException(
        `A ${principal.role} cannot edit ${section} on a form at the ${form.status} stage.`,
      );
    }
    return form;
  }

  /** QA observations against imported parameter scores. Scores are never writable. */
  async saveObservations(principal: Principal, id: string, input: ObservationInput[]) {
    const form = await this.authorize(principal, id, 'PARAMETERS');

    const bySortOrder = new Map(form.parameterResults.map((p) => [p.sortOrder, p]));
    for (const row of input) {
      if (!bySortOrder.has(row.sortOrder)) {
        throw new BadRequestException(`Parameter ${row.sortOrder} is not on this form.`);
      }
    }

    await this.prisma.$transaction(
      input.map((row) => this.prisma.formParameterResult.update({
        where: { formId_sortOrder: { formId: id, sortOrder: row.sortOrder } },
        // Only the observation. The imported answer and score are the .xlsx's
        // to state and nobody's to change here.
        data: { observedBehavior: row.observedBehavior?.trim() || null },
      })),
    );

    return { updated: input.length };
  }

  /** Hold Attempt Details — QA-owned, replaced wholesale. */
  async saveHoldAttempts(principal: Principal, id: string, input: HoldAttemptInput[]) {
    await this.authorize(principal, id, 'HOLD_ATTEMPTS');

    const reasons = await this.prisma.holdReason.findMany();
    const reasonId = (name?: string | null) =>
      reasons.find((r) => r.name === name)?.id ?? null;

    await this.prisma.$transaction([
      this.prisma.holdAttempt.deleteMany({ where: { formId: id } }),
      ...input.map((h) => this.prisma.holdAttempt.create({
        data: {
          formId: id,
          attemptNo: h.attemptNo,
          durationSeconds: h.durationSeconds ?? 0,
          holdReasonId: reasonId(h.reason),
          reasonValid: (h.reasonValid ?? 'NA') as never,
        },
      })),
      // Total hold time is denormalised on the form for the dashboards.
      this.prisma.coachingForm.update({
        where: { id },
        data: { totalHoldSeconds: input.reduce((a, h) => a + (h.durationSeconds ?? 0), 0) },
      }),
    ]);

    return { attempts: input.length };
  }

  /** Section C — root cause analysis. Ops TL-owned. */
  async saveRootCauses(principal: Principal, id: string, input: RootCauseInput[]) {
    const form = await this.authorize(principal, id, 'SECTION_C');

    const gaps = await this.prisma.rootCauseGap.findMany();
    const gapId = (name?: string | null) => gaps.find((g) => g.name === name)?.id ?? null;
    const resultId = (sortOrder?: number | null) =>
      sortOrder == null ? null : form.parameterResults.find((p) => p.sortOrder === sortOrder)?.id ?? null;

    await this.prisma.$transaction([
      this.prisma.rootCause.deleteMany({ where: { formId: id } }),
      ...input.map((r, i) => this.prisma.rootCause.create({
        data: {
          formId: id,
          parameterResultId: resultId(r.sortOrder),
          syntheticSource: r.sortOrder == null ? 'MANUAL' : null,
          situation: r.situation?.trim() || null,
          behavior: r.behavior?.trim() || null,
          impact: (IMPACT[r.impact ?? 'NONE'] ?? 'NO_IMPACT') as never,
          // The unique key is (formId, coachingPriority), so blank priorities
          // are numbered by position rather than colliding on null.
          coachingPriority: r.priority ?? i + 1,
          gapId: gapId(r.gap),
        },
      })),
    ]);

    return { rows: input.length };
  }

  /** Section D — the SMART action plan. Ops TL-owned. */
  async saveActionPlan(principal: Principal, id: string, input: ActionItemInput[]) {
    await this.authorize(principal, id, 'SECTION_D');

    await this.prisma.$transaction([
      this.prisma.actionPlanItem.deleteMany({ where: { formId: id } }),
      ...input.map((a, i) => this.prisma.actionPlanItem.create({
        data: {
          formId: id,
          priority: a.priority ?? i + 1,
          activity: a.activity?.trim() || null,
          deadline: a.deadline ? new Date(a.deadline) : null,
          successMeasure: a.successMeasure?.trim() || null,
          goal: a.goal?.trim() || null,
        },
      })),
    ]);

    return { items: input.length };
  }

  /**
   * Sign the form.
   *
   * The role decides which block is being signed — the request cannot choose.
   * That is what makes "the Ops TL may not sign for the agent" enforceable:
   * an Ops TL's signature can only ever land on `SUPERVISOR`, because that is
   * the only section `sectionAccess` will grant them.
   */
  async sign(principal: Principal, id: string, imageDataUrl: string) {
    const isAgent = principal.role === 'AGENT';

    // The route carries no `@RequirePermission`, because which signing
    // permission applies depends on the role. Check it here rather than
    // leaving the route gated on authentication alone.
    const needed = isAgent ? 'form:sign_agent' : 'form:sign_supervisor';
    if (!can(principal, needed)) {
      throw new ForbiddenException(`Your role (${principal.role}) cannot sign this block.`);
    }

    const section: CoachingSection = isAgent ? 'AGENT_SIGNATURE' : 'OPS_SIGNATURE';
    const form = await this.authorize(principal, id, section);

    if (!imageDataUrl?.startsWith('data:image/')) {
      throw new BadRequestException('A signature image is required.');
    }

    const contentHash = createHash('sha256').update(imageDataUrl).digest('hex');
    // Hashing the scored content means a later edit is detectable: the stored
    // hash no longer matches, so "this is what I signed" stays provable.
    const formHash = createHash('sha256')
      .update(JSON.stringify({
        id: form.id,
        revision: form.revision,
        results: form.parameterResults.map((p) => [p.sortOrder, p.answer, p.observedBehavior]),
      }))
      .digest('hex');

    const signerRole = isAgent ? 'AGENT' : 'SUPERVISOR';

    await this.prisma.formSignature.updateMany({
      where: { formId: id, signerRole: signerRole as never, supersededAt: null },
      data: { supersededAt: new Date() },
    });

    const created = await this.prisma.formSignature.create({
      data: {
        formId: id,
        signerId: principal.id,
        signerRole: signerRole as never,
        // Object storage is not wired yet, so the image is addressed by its
        // own hash. Swapping in an S3 key changes this line and nothing else.
        storageKey: `inline:${contentHash}`,
        contentHash,
        formHash,
        revision: form.revision,
      },
    });

    return { id: created.id, signerRole, signedAt: created.signedAt };
  }
}
