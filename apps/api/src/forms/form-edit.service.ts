import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FormStatus } from '@prisma/client';
import {
  can,
  csatCategory,
  deriveRootCauses,
  diffList,
  diffRecord,
  hasSubstantiveChange,
  holdDurationSeconds,
  scoreForm,
  type ChangeEntry,
  type Principal,
  type UpsertFormInput,
} from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Editing a coaching form.
 *
 * The requirement is that a form stays editable at ALL times — including after
 * it has been signed. That is genuinely useful (a wrong call ID, a
 * misremembered date) but it collides with what a signature means. If a signed
 * form can change underneath the signature, then "Jenny acknowledged this" stops
 * being a fact about any particular content.
 *
 * The resolution implemented here:
 *
 *   - Any edit is allowed, in any status. Nothing is ever locked.
 *   - Every edit is diffed field by field and written to `form_change_log` with
 *     the actor, the old value, the new value, and the resulting revision.
 *   - Editing a COMPLETED form additionally requires `form:edit_completed` and
 *     a written reason.
 *   - A *substantive* edit (anything that changes what was scored or
 *     acknowledged) bumps `revision` and marks existing signatures superseded.
 *     The old signature rows are kept as evidence; the form returns to PENDING
 *     for whoever must re-acknowledge.
 *   - A cosmetic edit (typo in an observed-behavior note, action-plan wording)
 *     is logged but does not invalidate signatures — otherwise people would be
 *     re-signing constantly and would stop reading what they sign.
 */
@Injectable()
export class FormEditService {
  constructor(private readonly prisma: PrismaService) {}

  async update(
    principal: Principal,
    formId: string,
    input: UpsertFormInput,
    context: { reason?: string; ip?: string },
  ) {
    const existing = await this.prisma.coachingForm.findUnique({
      where: { id: formId },
      include: {
        parameterResults: { orderBy: { sortOrder: 'asc' } },
        holdAttempts: { orderBy: { attemptNo: 'asc' } },
        signatures: { where: { supersededAt: null, declined: false } },
        template: { include: { parameters: { where: { isActive: true } } } },
      },
    });
    if (!existing) throw new NotFoundException('Coaching form not found');

    const isCompleted = existing.status === FormStatus.FINALIZED;
    if (isCompleted && !can(principal, 'form:edit_completed')) {
      throw new ForbiddenException(
        'This form is completed. Only a QA Team Lead, QA Manager or Admin can edit it.',
      );
    }
    if (isCompleted && !context.reason?.trim()) {
      throw new BadRequestException(
        'Editing a completed form requires a reason — it is recorded in the change log.',
      );
    }
    if (existing.status === FormStatus.VOIDED) {
      throw new BadRequestException('This form is voided. Restore it before editing.');
    }

    // ---- recompute scores server-side; the client's numbers are never trusted
    const paramById = new Map(existing.template.parameters.map((p) => [p.id, p]));
    const scorable = input.parameters.map((p) => {
      const definition = paramById.get(p.parameterId);
      if (!definition) {
        throw new BadRequestException(`Parameter ${p.parameterId} is not on this form.`);
      }
      return {
        sortOrder: definition.sortOrder,
        criticalType: definition.criticalType,
        weight: Number(definition.weight),
        answer: p.answer,
        observedBehavior: p.observedBehavior ?? null,
        parameterId: p.parameterId,
        text: definition.text,
      };
    });

    const score = scoreForm(scorable);
    const category = csatCategory(input.wasSurveyed, input.surveyScore);

    const holds = input.holdAttempts.map((h) => ({
      ...h,
      durationSeconds: holdDurationSeconds(h.startAt ?? null, h.endAt ?? null),
    }));
    const totalHoldSeconds = holds.reduce((a, h) => a + h.durationSeconds, 0);

    // ---- diff -------------------------------------------------------
    const changes: ChangeEntry[] = [
      ...diffRecord(existing, {
        callId: input.callId,
        callDate: input.callDate,
        auditDate: input.auditDate,
        callReasonId: input.callReasonId ?? null,
        ahtSeconds: input.ahtSeconds ?? null,
        ivrAuthenticated: input.ivrAuthenticated ?? null,
        agentReverified: input.agentReverified ?? null,
        verifiedNonIvr: input.verifiedNonIvr ?? null,
        usedServiceCloud: input.usedServiceCloud ?? null,
        wasSurveyed: input.wasSurveyed,
        surveyScore: input.surveyScore ?? null,
        respondentCategory: category,
        controllable: input.controllable ?? null,
        observedDriverId: input.observedDriverId ?? null,
        customerVerbatim: input.customerVerbatim ?? null,
        totalHoldSeconds,
      }),
      ...diffList(
        existing.parameterResults.map((r) => ({
          key: r.parameterId,
          answer: r.answer,
          observedBehavior: r.observedBehavior,
        })),
        scorable.map((p) => ({
          key: p.parameterId,
          answer: p.answer,
          observedBehavior: p.observedBehavior,
        })),
        { key: 'key', prefix: 'parameters' },
      ),
      ...diffList(
        existing.holdAttempts.map((h) => ({
          key: String(h.attemptNo),
          startAt: h.startAt,
          endAt: h.endAt,
          holdReasonId: h.holdReasonId,
          reasonValid: h.reasonValid,
        })),
        holds.map((h) => ({
          key: String(h.attemptNo),
          startAt: h.startAt ?? null,
          endAt: h.endAt ?? null,
          holdReasonId: h.holdReasonId ?? null,
          reasonValid: h.reasonValid,
        })),
        { key: 'key', prefix: 'holdAttempts' },
      ),
    ];

    if (changes.length === 0) {
      return { form: existing, changesRecorded: 0, signaturesSuperseded: 0 };
    }

    const substantive = hasSubstantiveChange(changes);
    const hadSignatures = existing.signatures.length > 0;
    const nextRevision = substantive ? existing.revision + 1 : existing.revision;

    return this.prisma.$transaction(async (tx) => {
      // 1. header + scores
      const form = await tx.coachingForm.update({
        where: { id: formId },
        data: {
          callId: input.callId,
          callDate: input.callDate,
          auditDate: input.auditDate,
          callReasonId: input.callReasonId ?? null,
          ahtSeconds: input.ahtSeconds ?? null,
          ivrAuthenticated: input.ivrAuthenticated ?? null,
          agentReverified: input.agentReverified ?? null,
          verifiedNonIvr: input.verifiedNonIvr ?? null,
          usedServiceCloud: input.usedServiceCloud ?? null,
          wasSurveyed: input.wasSurveyed,
          surveyScore: input.surveyScore ?? null,
          respondentCategory: category,
          controllable: input.controllable ?? null,
          observedDriverId: input.observedDriverId ?? null,
          customerVerbatim: input.customerVerbatim ?? null,
          totalHoldSeconds,
          qaScore: score.qaScore,
          customerCriticalCount: score.customerCriticalCount,
          processCriticalCount: score.processCriticalCount,
          businessCriticalCount: score.businessCriticalCount,
          revision: nextRevision,
          // A substantive edit to a signed form sends it back for
          // re-acknowledgement rather than leaving it FINALIZED with a
          // signature that covers different content. It re-enters the workflow
          // at the agent-signature stage, and `finalizedAt` is cleared so the
          // form drops out of completion metrics until it is signed again.
          ...(substantive && hadSignatures && isCompleted
            ? {
                status: FormStatus.AWAITING_AGENT_SIGNATURE,
                awaitingSignatureAt: new Date(),
                finalizedAt: null,
              }
            : {}),
        },
      });

      // 2. parameter results (snapshotting text and weight)
      for (const p of scorable) {
        await tx.formParameterResult.upsert({
          where: { formId_sortOrder: { formId, sortOrder: p.sortOrder } },
          update: {
            answer: p.answer,
            observedBehavior: p.observedBehavior,
            score: p.answer === 'NO' ? 0 : p.weight,
          },
          create: {
            formId,
            parameterId: p.parameterId,
            sortOrder: p.sortOrder,
            textSnapshot: p.text,
            weightSnapshot: p.weight,
            criticalType: p.criticalType,
            answer: p.answer,
            observedBehavior: p.observedBehavior,
            score: p.answer === 'NO' ? 0 : p.weight,
          },
        });
      }

      // 3. hold attempts
      for (const h of holds) {
        await tx.holdAttempt.upsert({
          where: { formId_attemptNo: { formId, attemptNo: h.attemptNo } },
          update: {
            startAt: h.startAt ?? null,
            endAt: h.endAt ?? null,
            durationSeconds: h.durationSeconds,
            holdReasonId: h.holdReasonId ?? null,
            reasonValid: h.reasonValid,
          },
          create: {
            formId,
            attemptNo: h.attemptNo,
            startAt: h.startAt ?? null,
            endAt: h.endAt ?? null,
            durationSeconds: h.durationSeconds,
            holdReasonId: h.holdReasonId ?? null,
            reasonValid: h.reasonValid,
          },
        });
      }

      // 4. section C — regenerated from the failures, never client-supplied.
      //    Coach-authored fields (priority, gap) are preserved across the
      //    regeneration for parameters that are still failing.
      const keepers = await tx.rootCause.findMany({ where: { formId } });
      const keepByParam = new Map(
        keepers.filter((k) => k.parameterResultId).map((k) => [k.parameterResultId!, k]),
      );
      await tx.rootCause.deleteMany({ where: { formId } });

      const derived = deriveRootCauses(scorable, { category });
      for (const row of derived) {
        const result =
          row.sortOrder == null
            ? null
            : await tx.formParameterResult.findUnique({
                where: { formId_sortOrder: { formId, sortOrder: row.sortOrder } },
              });
        const previous = result ? keepByParam.get(result.id) : undefined;
        await tx.rootCause.create({
          data: {
            formId,
            parameterResultId: result?.id ?? null,
            syntheticSource: row.syntheticSource,
            situation: row.situation,
            behavior: row.behavior,
            impact: row.impact as any,
            coachingPriority: previous?.coachingPriority ?? null,
            gapId: previous?.gapId ?? null,
          },
        });
      }

      // 5. the change log
      const logged = await tx.formChangeLog.createManyAndReturn({
        data: changes.map((c) => ({
          formId,
          actorId: principal.id,
          revision: nextRevision,
          action: c.field.startsWith('parameters')
            ? 'parameter.answer_changed'
            : c.field.startsWith('holdAttempts')
              ? 'hold.changed'
              : 'form.field_changed',
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          reason: context.reason ?? null,
          afterSignature: hadSignatures,
          ip: context.ip ?? null,
        })),
      });

      // 6. supersede signatures — kept, never deleted; they are the evidence
      //    that someone acknowledged revision N.
      let signaturesSuperseded = 0;
      if (substantive && hadSignatures) {
        const result = await tx.formSignature.updateMany({
          where: { formId, supersededAt: null },
          data: {
            supersededAt: new Date(),
            supersededByChangeId: logged[0]?.id ?? null,
          },
        });
        signaturesSuperseded = result.count;
      }

      return { form, changesRecorded: changes.length, signaturesSuperseded, substantive };
    });
  }

  /** Per-form history panel. */
  async history(formId: string, take = 300) {
    return this.prisma.formChangeLog.findMany({
      where: { formId },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
