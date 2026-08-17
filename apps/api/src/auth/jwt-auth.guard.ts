import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Principal } from '@awr/shared';
import { PUBLIC_KEY } from './rbac.guard.js';
import { AuthService, type AccessTokenClaims } from './auth.service.js';

export const ACCESS_COOKIE = 'awr_access';
export const REFRESH_COOKIE = 'awr_refresh';

/** The request, once authenticated. */
export interface AuthedRequest extends Request {
  principal?: Principal;
}

/**
 * Authenticates the request and attaches a `Principal`.
 *
 * Runs before `RbacGuard`, which answers "may this role do this" — it has no
 * way to establish *who* is asking. Registering RbacGuard without this one
 * would leave every route open, so both are registered together as global
 * guards in AuthModule, in this order.
 *
 * The token is read from an httpOnly cookie first (browsers) and falls back to
 * a bearer header (scripts, tests, service calls).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = JwtAuthGuard.extract(req);
    if (!token) throw new UnauthorizedException('Not signed in');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      // Expired or tampered — the client should refresh, not retry.
      throw new UnauthorizedException('Session expired');
    }

    // Re-read the principal from the database rather than trusting the token's
    // copy: a deactivated user or a role change must take effect immediately,
    // not whenever the access token happens to expire.
    req.principal = await this.auth.principalFor(claims.sub);
    return true;
  }

  private static extract(req: Request): string | null {
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (fromCookie) return fromCookie;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return null;
  }
}
