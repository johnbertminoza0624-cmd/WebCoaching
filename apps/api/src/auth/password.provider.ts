import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthProvider, AuthenticatedIdentity } from './auth-provider.interface.js';

/**
 * A dummy hash to verify against when the email doesn't exist. Without it, a
 * missing user returns fast and a real user returns slow, and the timing gap
 * tells an attacker which emails are registered.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$C1G6VpvJ8cQKQ7L1kkKQRQXKz9CxLQ1yBQXxr3PZFmU';

@Injectable()
export class PasswordProvider implements AuthProvider {
  readonly id = 'password' as const;
  readonly displayName = 'Email and password';

  constructor(private readonly prisma: PrismaService) {}

  async authenticate(payload: Record<string, unknown>): Promise<AuthenticatedIdentity> {
    const email = String(payload.email ?? '').toLowerCase().trim();
    const password = String(payload.password ?? '');

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a verification, even with no user, so both paths cost the same.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    let valid = false;
    try {
      valid = await argon2.verify(hash, password);
    } catch {
      valid = false;
    }

    // One message for every failure mode — never "no such user".
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active. Contact an administrator.');
    }

    // Transparently upgrade hashes when the cost parameters change.
    // `needsRehash`'s options cover cost params only — not `type` — because
    // the digest string already encodes its algorithm (e.g. "$argon2id$...").
    // No options here means "compare against the same defaults `hash()` below
    // uses", which is exactly what we want since neither call overrides them.
    if (argon2.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
      });
    }

    return { user, mustChangePassword: user.mustChangePassword };
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }
}
