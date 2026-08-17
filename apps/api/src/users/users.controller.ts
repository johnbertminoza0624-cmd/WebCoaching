import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/rbac.guard.js';
import type { AuthedRequest } from '../auth/jwt-auth.guard.js';
import { UsersService, type CreateUserInput, type UpdateUserInput } from './users.service.js';
import type { Role } from '@awr/shared';

/**
 * User and role administration.
 *
 * Page access alone is not authority here: a QA Manager reaches this page but
 * administers only their own account, which the service enforces by scoping
 * every query. Role changes and deactivation carry their own permissions.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission('user:read')
  @Get()
  list(@Req() req: AuthedRequest, @Query('search') search?: string, @Query('role') role?: string) {
    return this.users.list(req.principal!, { search, role });
  }

  @RequirePermission('user:read')
  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.users.get(req.principal!, id);
  }

  /** Roles this actor may assign to this target — empty for yourself. */
  @RequirePermission('user:read')
  @Get(':id/assignable-roles')
  assignable(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.users.assignable(req.principal!, id);
  }

  @RequirePermission('user:read')
  @Get(':id/role-history')
  roleHistory(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.users.roleHistory(req.principal!, id);
  }

  @RequirePermission('user:create')
  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateUserInput) {
    return this.users.create(req.principal!, body);
  }

  @RequirePermission('user:update')
  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: UpdateUserInput) {
    return this.users.update(req.principal!, id, body);
  }

  @RequirePermission('user:change_role')
  @Post(':id/role')
  changeRole(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { role: Role; reason: string },
  ) {
    return this.users.changeRole(req.principal!, id, body?.role, body?.reason ?? '');
  }

  @RequirePermission('user:deactivate')
  @Post(':id/status')
  setStatus(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { active: boolean }) {
    return this.users.setStatus(req.principal!, id, !!body?.active);
  }

  @RequirePermission('user:reset_password')
  @Post(':id/reset-password')
  resetPassword(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { temporaryPassword: string },
  ) {
    return this.users.resetPassword(req.principal!, id, body?.temporaryPassword ?? '');
  }
}
