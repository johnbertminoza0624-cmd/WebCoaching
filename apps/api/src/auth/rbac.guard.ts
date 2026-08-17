import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission, type Principal } from '@awr/shared';

export const PERMISSIONS_KEY = 'awr:permissions';

/**
 * Declares what a route needs. Note this answers only "may this role do this
 * kind of thing" — it deliberately does NOT scope rows. Services must still
 * compose `buildFormScopeFilter(principal)` into their queries.
 *
 *   @RequirePermission('form:void')
 *   @Delete(':id')
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Marks a route as reachable without authentication. */
export const PUBLIC_KEY = 'awr:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException('Sign in to continue');

    // No decorator means authentication is enough. This is a deliberate default:
    // it fails closed on authentication and open on authorization, so a route
    // that needs a permission and forgets the decorator is still not anonymous.
    if (!required || required.length === 0) return true;

    const missing = required.filter((p) => !can(principal, p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Your role (${principal.role}) cannot perform this action.`,
      );
    }
    return true;
  }
}
