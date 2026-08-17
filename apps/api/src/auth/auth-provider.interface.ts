import type { User } from '@prisma/client';

/**
 * Authentication provider contract.
 *
 * You asked for passwords now and Azure AD SSO later. The way that usually goes
 * wrong is that password logic gets written straight into AuthService, and
 * adding SSO later means rewriting the guards, the session shape, and the
 * refresh flow. So the provider is an interface from day one: `PasswordProvider`
 * is the only registered implementation today, and `AzureAdProvider` drops in
 * beside it without anything downstream changing.
 *
 * Everything after authentication — token issuance, refresh rotation, RBAC —
 * is provider-agnostic and lives in AuthService.
 */
export interface AuthenticatedIdentity {
  user: User;
  /** True when the provider wants the app to force a password change. */
  mustChangePassword: boolean;
}

export interface AuthProvider {
  /** Stable id used in AUTH_PROVIDERS and on the login screen. */
  readonly id: 'password' | 'azure-ad';
  readonly displayName: string;

  /**
   * Resolve credentials to a user, or throw UnauthorizedException.
   *
   * Implementations MUST NOT distinguish "no such user" from "wrong password"
   * in the error they throw — that difference is a user-enumeration oracle.
   */
  authenticate(payload: Record<string, unknown>): Promise<AuthenticatedIdentity>;
}

export const AUTH_PROVIDERS = Symbol('AUTH_PROVIDERS');
