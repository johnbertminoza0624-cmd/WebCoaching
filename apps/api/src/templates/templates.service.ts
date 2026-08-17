import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TemplateStatus } from '@prisma/client';
import {
  can,
  diffList,
  diffRecord,
  validateWeights,
  type ChangeEntry,
  type Principal,
} from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The coaching-form repository.
 *
 * The platform serves more than Care and Claims: each program has its own form,
 * and QA / QA Managers / Admins choose which one an audit runs on. Templates
 * with `accountId = null` are global and offered to every account.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The repository list. Auditors see only PUBLISHED templates — a half-written
   * draft must never be selectable for a real audit — while template owners see
   * drafts and archives too.
   */
  async list(principal: Principal, opts: { includeUnpublished?: boolean } = {}) {
    const canSeeDrafts = opts.includeUnpublished && can(principal, 'template:manage');

    return this.prisma.formTemplate.findMany({
      where: {
        AND: [
          canSeeDrafts ? {} : { status: TemplateStatus.PUBLISHED },
          // Global templates (accountId null) plus this principal's own account.
          principal.role === 'ADMIN' || principal.role === 'SERVICE_DELIVERY_MANAGER'
            ? {}
            : { OR: [{ accountId: null }, { accountId: principal.accountId }] },
        ],
      },
      include: {
        account: { select: { id: true, name: true } },
        // The repository screens render the parameter table straight from this
        // list, so the rows come with it rather than needing a fetch per card.
        parameters: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { parameters: true, forms: true } },
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: {
        parameters: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        account: { select: { id: true, name: true } },
      },
    });
    if (!template) throw new NotFoundException('Coaching form not found');
    return template;
  }

  /**
   * Selectable templates for a new audit, for the account the agent sits in.
   * Called by the form builder's "which coaching form?" step.
   */
  async selectableFor(accountId: string | null) {
    return this.prisma.formTemplate.findMany({
      where: {
        AND: [
          { status: TemplateStatus.PUBLISHED },
          { effectiveFrom: { lte: new Date() } },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
          { OR: [{ accountId: null }, ...(accountId ? [{ accountId }] : [])] },
        ],
      } satisfies Prisma.FormTemplateWhereInput,
      select: {
        id: true,
        name: true,
        version: true,
        lineOfBusiness: true,
        description: true,
        accountId: true,
        _count: { select: { parameters: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ----------------------------------------------------------------
  // Editing — always allowed, always logged
  // ----------------------------------------------------------------

  /**
   * Update a template and its parameters, recording a change-log row per field.
   *
   * Two rules that keep the repository honest:
   *
   *  1. **Weights must total exactly 1.0.** A template summing to 0.95 silently
   *     caps every agent scored on it at 95% and nobody notices for a quarter.
   *
   *  2. **A PUBLISHED template that has already scored audits cannot be edited
   *     in place** — editing it would change what those audits were measured
   *     against. It forks to a new version instead. Existing audits keep their
   *     snapshotted text and weights either way, but the fork keeps the
   *     repository readable.
   */
  async update(
    principal: Principal,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      lineOfBusiness?: string | null;
      agentAckText?: string;
      supervisorAckText?: string;
      parameters?: Array<{
        id?: string;
        sortOrder: number;
        criticalType: 'CUSTOMER' | 'PROCESS' | 'BUSINESS';
        text: string;
        weight: number;
      }>;
      note?: string;
    },
  ) {
    const existing = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: { parameters: { orderBy: { sortOrder: 'asc' } }, _count: { select: { forms: true } } },
    });
    if (!existing) throw new NotFoundException('Coaching form not found');

    if (existing.status === TemplateStatus.PUBLISHED && existing._count.forms > 0) {
      throw new BadRequestException(
        `This form has already scored ${existing._count.forms} audit(s). ` +
          'Create a new version instead of editing it in place.',
      );
    }

    if (input.parameters) {
      const { ok, total } = validateWeights(input.parameters.map((p) => p.weight));
      if (!ok) {
        throw new BadRequestException(
          `Parameter weights total ${total.toFixed(4)}; they must total exactly 1.0000.`,
        );
      }
    }

    // Diff BEFORE writing — the log is derived from reality, not from the caller.
    const changes: ChangeEntry[] = diffRecord(existing, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.lineOfBusiness !== undefined && { lineOfBusiness: input.lineOfBusiness }),
      ...(input.agentAckText !== undefined && { agentAckText: input.agentAckText }),
      ...(input.supervisorAckText !== undefined && { supervisorAckText: input.supervisorAckText }),
    });

    if (input.parameters) {
      changes.push(
        ...diffList(
          existing.parameters.map((p) => ({
            key: String(p.sortOrder),
            text: p.text,
            weight: Number(p.weight),
            criticalType: p.criticalType,
          })),
          input.parameters.map((p) => ({
            key: String(p.sortOrder),
            text: p.text,
            weight: p.weight,
            criticalType: p.criticalType,
          })),
          { key: 'key', prefix: 'parameters', label: (p) => String(p.text) },
        ),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.formTemplate.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          lineOfBusiness: input.lineOfBusiness,
          agentAckText: input.agentAckText,
          supervisorAckText: input.supervisorAckText,
        },
      });

      if (input.parameters) {
        // Deactivate rather than delete: a removed parameter is still
        // referenced by every audit ever scored against it.
        await tx.templateParameter.updateMany({
          where: { templateId: id },
          data: { isActive: false },
        });
        for (const p of input.parameters) {
          await tx.templateParameter.upsert({
            where: { templateId_sortOrder: { templateId: id, sortOrder: p.sortOrder } },
            update: {
              criticalType: p.criticalType,
              text: p.text,
              weight: p.weight,
              isActive: true,
            },
            create: {
              templateId: id,
              sortOrder: p.sortOrder,
              criticalType: p.criticalType,
              text: p.text,
              weight: p.weight,
            },
          });
        }
      }

      if (changes.length > 0) {
        await tx.templateChangeLog.createMany({
          data: changes.map((c) => ({
            templateId: id,
            actorId: principal.id,
            action: c.field.startsWith('parameters')
              ? 'parameter.changed'
              : 'template.updated',
            field: c.field,
            oldValue: c.oldValue,
            newValue: c.newValue,
            note: input.note ?? null,
          })),
        });
      }

      return { template: updated, changesRecorded: changes.length };
    });
  }

  /** Fork a published template to a new version, copying its parameters. */
  async createVersion(principal: Principal, id: string, newVersion: string) {
    const source = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.formTemplate.create({
        data: {
          slug: source.slug,
          name: source.name,
          description: source.description,
          lineOfBusiness: source.lineOfBusiness,
          version: newVersion,
          status: TemplateStatus.DRAFT,
          accountId: source.accountId,
          createdById: principal.id,
          agentAckText: source.agentAckText,
          supervisorAckText: source.supervisorAckText,
          parameters: {
            create: source.parameters.map((p) => ({
              sortOrder: p.sortOrder,
              criticalType: p.criticalType,
              text: p.text,
              weight: p.weight,
            })),
          },
        },
      });

      await tx.templateChangeLog.create({
        data: {
          templateId: created.id,
          actorId: principal.id,
          action: 'template.created',
          note: `Forked from ${source.name} v${source.version}`,
        },
      });

      return created;
    });
  }

  async publish(principal: Principal, id: string) {
    const template = await this.findOne(id);
    const { ok, total } = validateWeights(template.parameters.map((p) => Number(p.weight)));
    if (!ok) {
      throw new BadRequestException(
        `Cannot publish: weights total ${total.toFixed(4)}, expected 1.0000.`,
      );
    }
    if (template.parameters.length === 0) {
      throw new BadRequestException('Cannot publish a form with no parameters.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.formTemplate.update({
        where: { id },
        data: { status: TemplateStatus.PUBLISHED },
      });
      await tx.templateChangeLog.create({
        data: {
          templateId: id,
          actorId: principal.id,
          action: 'template.published',
          field: 'status',
          oldValue: template.status,
          newValue: TemplateStatus.PUBLISHED,
        },
      });
      return updated;
    });
  }

  /** The history panel. Anyone who can read the repository can read its history. */
  /**
   * Archive a form, or bring it back.
   *
   * Archiving never deletes: existing audits were scored against this version
   * and reference it, so it is withdrawn from selection rather than removed.
   * Restoring returns it to DRAFT, not PUBLISHED — coming back into service
   * should be a deliberate publish, not a side effect of un-archiving.
   */
  async setArchived(principal: Principal, id: string, archived: boolean) {
    const template = await this.findOne(id);
    const next = archived ? TemplateStatus.ARCHIVED : TemplateStatus.DRAFT;
    if (template.status === next) return template;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.formTemplate.update({ where: { id }, data: { status: next } });
      await tx.templateChangeLog.create({
        data: {
          templateId: id,
          actorId: principal.id,
          action: archived ? 'template.archived' : 'template.restored',
          field: 'status',
          oldValue: template.status,
          newValue: next,
        },
      });
      return updated;
    });
  }

  /** A brand-new form, always created as a DRAFT with no parameters yet. */
  async create(
    principal: Principal,
    input: { name: string; slug: string; version: string; lineOfBusiness?: string | null; accountId?: string | null },
  ) {
    if (!input?.name?.trim()) throw new BadRequestException('A form name is required.');

    const slug = (input.slug || input.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await this.prisma.formTemplate.findFirst({
      where: { slug, version: input.version || '1.0' },
    });
    if (existing) throw new BadRequestException('A form with that slug and version already exists.');

    const created = await this.prisma.formTemplate.create({
      data: {
        slug,
        name: input.name.trim(),
        version: input.version || '1.0',
        lineOfBusiness: input.lineOfBusiness ?? null,
        // Scoped to the creator's account unless they explicitly make it global.
        accountId: input.accountId === null ? null : (input.accountId ?? principal.accountId),
        status: TemplateStatus.DRAFT,
        agentAckText: 'I acknowledge the observations and findings from this coaching session.',
        supervisorAckText: 'I acknowledge the observations and commit to the agreed action plan.',
      },
    });

    await this.prisma.templateChangeLog.create({
      data: {
        templateId: created.id,
        actorId: principal.id,
        action: 'template.created',
        note: `Created as ${created.version}`,
      },
    });
    return created;
  }

  async changeLog(id: string, take = 200) {
    return this.prisma.templateChangeLog.findMany({
      where: { templateId: id },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
