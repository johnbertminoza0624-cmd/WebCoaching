import {
  BadRequestException, Body, Controller, Get, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from './rbac.guard.js';
import { AuthService, type TokenPair } from './auth.service.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthedRequest } from './jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  provider: z.enum(['password', 'azure-ad']).default('password'),
});

/**
 * The password policy, stated once and enforced here rather than in the
 * browser. The matching client-side check in the change-password form exists
 * only to give immediate feedback — it is not what makes a weak password
 * impossible.
 */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z
    .string()
    .min(12, 'New password must be at least 12 characters')
    .max(200, 'New password is too long')
    .regex(/[a-z]/, 'New password must include a lowercase letter')
    .regex(/[A-Z]/, 'New password must include an uppercase letter')
    .regex(/[0-9]/, 'New password must include a number'),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Tokens go in httpOnly cookies, never in the response body.
   *
   * A token readable by JavaScript is a token any injected script can take;
   * httpOnly means XSS cannot exfiltrate the session. `sameSite: lax` blocks
   * cross-site form posts while keeping ordinary top-level navigation working.
   */
  private setCookies(res: Response, tokens: TokenPair) {
    const secure = this.config.get<string>('NODE_ENV') === 'production';
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    const base = { httpOnly: true, sameSite: 'lax' as const, secure, domain, path: '/' };

    res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.accessMaxAge * 1000 });
    // Scoped to the refresh route so it is not sent with every ordinary request.
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...base, path: '/api/auth', maxAge: tokens.refreshMaxAge * 1000,
    });
  }

  private clearCookies(res: Response) {
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    res.clearCookie(ACCESS_COOKIE, { domain, path: '/' });
    res.clearCookie(REFRESH_COOKIE, { domain, path: '/api/auth' });
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = loginSchema.safeParse(body);
    // Never echo which field failed on a login form — that is an enumeration aid.
    if (!parsed.success) throw new BadRequestException('Email and password are required');

    const { email, password, provider } = parsed.data;
    const result = await this.auth.login(
      provider,
      { email, password },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );

    this.setCookies(res, result.tokens);
    return { user: result.user, mustChangePassword: result.mustChangePassword };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!presented) throw new UnauthorizedException('Not signed in');

    const tokens = await this.auth.refresh(presented, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setCookies(res, tokens);
    return { ok: true };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
    this.clearCookies(res);
    return { ok: true };
  }

  /**
   * Change your own password. Deliberately not `@Public()` — it operates on
   * `req.principal`, so a caller can only ever change the password of the
   * account they are already signed in as. There is no user id in the body,
   * which means there is no way to aim this at somebody else.
   */
  @Post('change-password')
  async changePassword(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const tokens = await this.auth.changePassword(
      req.principal!.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE],
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );

    // Re-cookie the caller with the freshly issued pair; every other session
    // for this user was revoked inside `changePassword`.
    this.setCookies(res, tokens);
    return { ok: true };
  }

  /** Who am I — the frontend's session bootstrap. Requires a valid access token. */
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const principal = req.principal!;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.id } });
    return { user: AuthService.publicUser(user), principal };
  }
}
