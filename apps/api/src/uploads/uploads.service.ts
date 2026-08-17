import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerValue, FormStatus, type Prisma } from '@prisma/client';
import type { Principal } from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Importing audits from the uploaded workbook.
 *
 * The browser parses the `.xlsx` (it already owns the template it generated)
 * and posts the rows; the server validates them against the chosen template and
 * creates the coaching forms. Parsing stays client-side, but *nothing about
 * what gets created* is taken on trust: the parameter set, the scores, the
 * people and the duplicate check are all resolved here.
 *
 * The imported values are the source of truth for the audit, so this is the
 * only place they are ever written.
 */

export interface UploadRow {
  /** The standard block, keyed by the template's column headings. */
  standard: Record<string, string>;
  /** Parameter results keyed by sortOrder. */
  params: Record<string, 'YES' | 'NO' | 'NA'>;
}

export interface UploadResult {
  created: number;
  skipped: { callId: string; reason: string }[];
}

const ANSWER: Record<string, AnswerValue> = {
  YES: AnswerValue.YES, NO: AnswerValue.NO, NA: AnswerValue.NA,
};

/** Seconds from "HH:MM:SS", "MM:SS" or a plain count. */
function durationSeconds(v: string | undefined): number {
  const t = (v ?? '').trim();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseDate(v: string | undefined): Date | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
}

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async import(principal: Principal, templateId: string, rows: UploadRow[]): Promise<UploadResult> {
    if (!rows?.length) throw new BadRequestException('The file contained no rows.');

    const template = await this.prisma.formTemplate.findUnique({
      where: { id: templateId },
      include: { parameters: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Coaching form not found');
    if (template.status !== 'PUBLISHED') {
      throw new BadRequestException('Audits can only be imported against a published form.');
    }
    // A template belonging to another account must not become a way to create
    // records in it.
    if (template.accountId && principal.accountId && template.accountId !== principal.accountId) {
      throw new NotFoundException('Coaching form not found');
    }

    // Resolve people once rather than per row.
    const eids = rows.map((r) => r.standard['EID']?.trim()).filter(Boolean) as string[];
    const names = rows.map((r) => r.standard['Agent Name']?.trim()).filter(Boolean) as string[];
    const agents = await this.prisma.user.findMany({
      where: { OR: [{ eid: { in: eids } }, { AND: [{ role: 'AGENT' }, { id: { in: [] } }] }] },
      include: { team: true },
    });
    const byEid = new Map(agents.filter((a) => a.eid).map((a) => [a.eid!, a]));

    const auditors = await this.prisma.user.findMany({
      where: { role: { in: ['QA', 'QA_TEAM_LEAD', 'QA_MANAGER'] } },
    });
    const auditorByName = new Map(
      auditors.map((u) => [`${u.firstName} ${u.lastName}`.trim().toLowerCase(), u]),
    );

    const callIds = rows.map((r) => r.standard['Call ID']?.trim()).filter(Boolean) as string[];
    const existing = await this.prisma.coachingForm.findMany({
      where: { callId: { in: callIds } },
      select: { callId: true },
    });
    const alreadyImported = new Set(existing.map((e) => e.callId));

    const skipped: UploadResult['skipped'] = [];
    const creates: Prisma.CoachingFormCreateInput[] = [];

    for (const row of rows) {
      const callId = row.standard['Call ID']?.trim();
      if (!callId) { skipped.push({ callId: '(blank)', reason: 'No Call ID' }); continue; }

      // Re-uploading the same file must not double the audits.
      if (alreadyImported.has(callId)) {
        skipped.push({ callId, reason: 'Already imported' });
        continue;
      }
      alreadyImported.add(callId);

      const agent = byEid.get(row.standard['EID']?.trim() ?? '');
      if (!agent) {
        skipped.push({ callId, reason: `No user with EID ${row.standard['EID'] ?? '(blank)'}` });
        continue;
      }

      const callDate = parseDate(row.standard['Call Date']);
      const auditDate = parseDate(row.standard['Audit Date']);
      if (!callDate || !auditDate) {
        skipped.push({ callId, reason: 'Call Date and Audit Date are required' });
        continue;
      }

      // The uploader is the auditor unless the sheet names someone else.
      const named = row.standard['Quality Auditor']?.trim().toLowerCase();
      const auditor = (named && auditorByName.get(named)) || null;

      const results = template.parameters.map((p) => {
        const answer = ANSWER[(row.params[String(p.sortOrder)] ?? 'NA').toUpperCase()] ?? AnswerValue.NA;
        return {
          parameterId: p.id,
          sortOrder: p.sortOrder,
          textSnapshot: p.text,
          weightSnapshot: p.weight,
          criticalType: p.criticalType,
          answer,
          score: answer === AnswerValue.NO ? 0 : p.weight,
        };
      });

      const earned = results.reduce((a, r) => a + Number(r.score), 0);
      const possible = results.reduce(
        (a, r) => a + (r.answer === AnswerValue.NA ? 0 : Number(r.weightSnapshot)), 0,
      );

      creates.push({
        reference: `AWR-${callId}`,
        template: { connect: { id: template.id } },
        status: FormStatus.QA_REVIEW,
        agent: { connect: { id: agent.id } },
        ...(agent.team?.leadId ? { supervisor: { connect: { id: agent.team.leadId } } } : {}),
        auditor: { connect: { id: auditor?.id ?? principal.id } },
        callDate,
        auditDate,
        callId,
        ahtSeconds: durationSeconds(row.standard['AHT']),
        totalHoldSeconds: durationSeconds(row.standard['Total Hold Time']),
        qaScore: possible > 0 ? earned / possible : 1,
        qaReviewAt: new Date(),
        parameterResults: { create: results },
      });
    }

    // One transaction: a partial import would leave the QA queue in a state
    // nobody asked for, and re-running would then skip the half that landed.
    await this.prisma.$transaction(
      creates.map((data) => this.prisma.coachingForm.create({ data })),
    );

    return { created: creates.length, skipped };
  }
}
