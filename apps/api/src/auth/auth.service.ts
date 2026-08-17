import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { User } from '@prisma/client';
import type { Principal } from '@awr/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AUTH_PROVIDERS, type AuthProvider } from './auth-provider.interface.js';

/**
 * Everything after authentication: token issuance, refresh rotation, and
 * turning a user row into the `Principal` the RBAC layer works with.
 *
 * Deliberately provider-agnostic — `PasswordProvider` resolves credentials,
 * and adding Azure AD later changes nothing in here.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Raw seconds, so the caller can set cookie maxAge without re-parsing TTLs. */
  accessMaxAge: number;
  refreshMaxAge: number;
}

/** What we put in the access token. Deliberately small — it is not a database. */
export interface AccessTokenClaims {
  sub: string;
  role: string;
  accountId: string | null;
  teamId: string | null;
  /** Team ids this user leads; needed for TEAM-scoped queries. */
  led: string[];
}

const SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * How long after a refresh token is rotated a replay of it is still read as a
 * concurrency race rather than theft. Deliberately short: long enough to cover
 * two tabs racing across a slow network, far too short to be a useful window
 * for an attacker who would also have to already hold the token.
 */
const REFRESH_REUSE_GRACE_MS = 15_000;

/** "15m" / "30d" / "3600" -> seconds. */
export function parseTtl(ttl: string, fallback: number): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!m) return fallback;
  return Number(m[1]) * (m[2] ? SECONDS[m[2]]! : 1);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(AUTH_PROVIDERS) private readonly providers: AuthProvider[],
  ) {}

  private get accessTtl() {
    return parseTtl(this.config.get<string>('JWT_ACCESS_TTL') ?? '15m', 900);
  }
  private get refreshTtl() {
    return parseTtl(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d', 2592000);
  }

  /** Refresh tokens are stored hashed — a leaked database must not be a set of valid sessions. */
  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * The identity every guard and every scoped query works from.
   *
   * `ledTeamIds` is resolved here rather than trusted from the token so that a
   * team reassignment takes effect immediately rather than at next login.
   */
  async principalFor(userId: string): Promise<Principal> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { leadsTeam: { select: { id: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session is no longer valid');
    }
    return {
      id: user.id,
      role: user.role,
      accountId: user.accountId,
      teamId: user.teamId,
      ledTeamIds: user.leadsTeam.map((t) => t.id),
    };
  }

  async login(providerId: string, payload: Record<string, unknown>, ctx: { ip?: string; userAgent?: string }) {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) throw new UnauthorizedException('Unknown sign-in method');

    const { user, mustChangePassword } = await provider.authenticate(payload);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issue(user, ctx);
    return { user: AuthService.publicUser(user), mustChangePassword, tokens };
  }

  /** Mints an access token and a fresh refresh token, recording the latter. */
  async issue(user: User, ctx: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const principal = await this.principalFor(user.id);
    const claims: AccessTokenClaims = {
      sub: principal.id,
      role: principal.role,
      accountId: principal.accountId,
      teamId: principal.teamId,
      led: principal.ledTeamIds,
    };

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtl,
    });

    // The refresh token is opaque: a random string we store hashed, not a JWT.
    // Nothing downstream should be able to read or trust its contents.
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: AuthService.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      accessMaxAge: this.accessTtl,
      refreshMaxAge: this.refreshTtl,
    };
  }

  /**
   * Rotates a refresh token: the presented one is revoked and a new pair
   * issued. A token that is already revoked is treated as theft — every
   * session for that user is killed rather than just refusing this one.
   */
  async refresh(presented: string, ctx: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const tokenHash = AuthService.hash(presented);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) throw new UnauthorizedException('Session expired, please sign in again');

    if (existing.revokedAt) {
      const sinceRevoked = Date.now() - existing.revokedAt.getTime();

      /**
       * Reuse detection, with a grace window for the benign case.
       *
       * Revoking the whole family on any replay is the textbook response to a
       * stolen token, and it stays that way below. But it also fired on a
       * completely innocent race: two tabs refreshing at the same instant both
       * present the same token, one rotates it, and the loser — a legitimate
       * client, milliseconds late — got every session killed. In practice that
       * signed people out of the app for having it open twice.
       *
       * Inside the window the presenter has demonstrably just held a valid
       * token, so it is treated as the race it almost certainly is and issued a
       * fresh pair. Outside it, nothing has changed: full family revocation.
       *
       * The client serialises refreshes across tabs with a Web Lock, so this
       * should now be unreachable in normal use — it is the backstop for
       * browsers without that API, not the primary fix.
       */
      if (sinceRevoked <= REFRESH_REUSE_GRACE_MS) {
        return this.issue(existing.user, ctx);
      }

      // Replay of a long-rotated token — assume the token was stolen.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return this.issue(existing.user, ctx);
  }

  /** Ends one session. Signing out must not end the user's other sessions. */
  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: AuthService.hash(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Changes the signed-in user's own password.
   *
   * Three things have to be true at once for this to be safe:
   *
   *  1. The current password is re-verified here even though the caller already
   *     holds a valid session. A live session proves the browser was
   *     authenticated at some point, not that the person at the keyboard knows
   *     the password — without this, an unattended logged-in machine is a
   *     permanent account takeover.
   *  2. Every *other* session is revoked. Changing a password is how a user
   *     responds to "someone else may have my credentials", so it has to end
   *     the sessions that credential could have created. The current session is
   *     re-issued rather than killed, so the user is not bounced to the login
   *     screen for doing the right thing.
   *  3. `mustChangePassword` clears, which is what lets the seeded first-login
   *     flow complete.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    presentedRefresh: string | undefined,
    ctx: { ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session is no longer valid');
    }
    // A user created through a provider that never set one (e.g. SSO) has no
    // local password to verify against, so there is nothing to change here.
    if (!user.passwordHash) {
      throw new BadRequestException('This account does not use a password to sign in');
    }

    let valid = false;
    try {
      valid = await argon2.verify(user.passwordHash, currentPassword);
    } catch {
      valid = false;
    }
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    if (await argon2.verify(user.passwordHash, newPassword).catch(() => false)) {
      throw new BadRequestException('New password must be different from the current one');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }),
          mustChangePassword: false,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(presentedRefresh ? { NOT: { tokenHash: AuthService.hash(presentedRefresh) } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    // The presented refresh token is retired too, and the caller gets a brand
    // new pair — so after this call exactly one session exists for this user.
    await this.logout(presentedRefresh);
    return this.issue(user, ctx);
  }

  /** Never let a password hash reach a response body. */
  static publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      eid: user.eid,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      accountId: user.accountId,
      teamId: user.teamId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
