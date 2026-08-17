import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { assignableRoles, can, type Principal, type Role } from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * User and role administration.
 *
 * Two rules from the architecture are enforced here rather than in the UI,
 * because they are the ones that make the audit trail worth anything:
 *
 *   1. Nobody may change their own role. `assignableRoles` returns an empty
 *      list when actor === target, so a self-promotion has nothing to promote
 *      to. Checked again below in case a caller passes a role anyway.
 *   2. Every role change writes a `RoleChange` row — actor, from, to, reason.
 *      An identity change with no record of who made it is not reviewable.
 */

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  eid?: string | null;
  accountId?: string | null;
  teamId?: string | null;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  eid?: string | null;
  teamId?: string | null;
  accountId?: string | null;
}

const PUBLIC_FIELDS = {
  id: true, email: true, eid: true, firstName: true, lastName: true,
  role: true, status: true, accountId: true, teamId: true,
  mustChangePassword: true, lastLoginAt: true, createdAt: true,
  team: {
    select: {
      id: true,
      name: true,
      wave: true,
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  },
  leadsTeam: {
    select: {
      id: true,
      name: true,
      wave: true,
    },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Administration is account-scoped for everyone except platform roles.
   *
   * A QA Manager may reach this page, but that must not mean they administer
   * another account's people.
   */
  private scope(principal: Principal): Prisma.UserWhereInput {
    if (principal.role === 'ADMIN' || principal.role === 'SERVICE_DELIVERY_MANAGER') return {};
    return principal.accountId ? { accountId: principal.accountId } : { id: '__none__' };
  }

  async list(principal: Principal, query: { search?: string; role?: string }) {
    const where: Prisma.UserWhereInput = { AND: [this.scope(principal)] };

    if (query.search) {
      (where.AND as Prisma.UserWhereInput[]).push({
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { eid: { contains: query.search } },
        ],
      });
    }
    if (query.role) {
      (where.AND as Prisma.UserWhereInput[]).push({ role: query.role as never });
    }

    const rows = await this.prisma.user.findMany({
      where,
      select: PUBLIC_FIELDS,
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    });
    return { rows, total: rows.length };
  }

  async get(principal: Principal, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { AND: [this.scope(principal), { id }] },
      select: PUBLIC_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Which roles this actor may assign to this target — drives the UI's picker. */
  async assignable(principal: Principal, targetId: string): Promise<Role[]> {
    await this.get(principal, targetId); // 404s if out of scope
    return assignableRoles(principal, targetId);
  }

  async create(principal: Principal, input: CreateUserInput) {
    const email = input.email?.toLowerCase().trim();
    if (!email) throw new BadRequestException('An email address is required.');

    if (!assignableRoles(principal, '__new__').includes(input.role)) {
      throw new ForbiddenException(`Your role cannot create a ${input.role}.`);
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('That email address is already in use.');

    // Created without a password: the account is unusable until an
    // administrator sets one, rather than shipping a guessable default.
    return this.prisma.user.create({
      data: {
        email,
        firstName: input.firstName?.trim() || '—',
        lastName: input.lastName?.trim() || '—',
        eid: input.eid?.trim() || null,
        role: input.role as never,
        accountId: input.accountId ?? principal.accountId,
        teamId: input.teamId ?? null,
        mustChangePassword: true,
      },
      select: PUBLIC_FIELDS,
    });
  }

  async update(principal: Principal, id: string, input: UpdateUserInput) {
    await this.get(principal, id);
    return this.prisma.user.update({
      where: { id },
      data: {
        firstName: input.firstName?.trim(),
        lastName: input.lastName?.trim(),
        eid: input.eid === undefined ? undefined : (input.eid?.trim() || null),
        teamId: input.teamId === undefined ? undefined : input.teamId,
        accountId: input.accountId === undefined ? undefined : input.accountId,
      },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Change a user's role.
   *
   * The reason is required, not decorative: a `RoleChange` row without one
   * records that something happened but not why, which is the half that
   * matters when the trail is reviewed.
   */
  async changeRole(principal: Principal, id: string, role: Role, reason: string) {
    const target = await this.get(principal, id);

    if (id === principal.id) {
      throw new ForbiddenException('You cannot change your own role.');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required for a role change.');
    }
    if (!assignableRoles(principal, id).includes(role)) {
      throw new ForbiddenException(`Your role cannot assign ${role}.`);
    }
    if (target.role === role) return target;

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { role: role as never }, select: PUBLIC_FIELDS }),
      this.prisma.roleChange.create({
        data: {
          userId: id,
          actorId: principal.id,
          fromRole: target.role as never,
          toRole: role as never,
          reason: reason.trim(),
        },
      }),
    ]);
    return updated;
  }

  /** Deactivate rather than delete — the audit trail references these people. */
  async setStatus(principal: Principal, id: string, active: boolean) {
    await this.get(principal, id);
    if (id === principal.id) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        status: (active ? 'ACTIVE' : 'INACTIVE') as never,
        deactivatedAt: active ? null : new Date(),
      },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Set a temporary password.
   *
   * Every existing session is revoked at the same time: a password reset that
   * leaves the old sessions alive does not lock anyone out.
   */
  async resetPassword(principal: Principal, id: string, temporaryPassword: string) {
    await this.get(principal, id);
    if (!can(principal, 'user:reset_password')) {
      throw new ForbiddenException('Your role cannot reset passwords.');
    }
    if ((temporaryPassword ?? '').length < 12) {
      throw new BadRequestException('A temporary password must be at least 12 characters.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash: await argon2.hash(temporaryPassword, { type: argon2.argon2id }),
          mustChangePassword: true,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { ok: true };
  }

  async roleHistory(principal: Principal, id: string) {
    await this.get(principal, id);
    return this.prisma.roleChange.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
