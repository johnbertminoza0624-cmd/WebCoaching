import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { PasswordProvider } from './password.provider.js';
import { AUTH_PROVIDERS } from './auth-provider.interface.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RbacGuard } from './rbac.guard.js';

/**
 * Authentication and the two global guards.
 *
 * Order matters and is not incidental: `JwtAuthGuard` establishes *who* is
 * asking and attaches the `Principal`; `RbacGuard` then asks whether that role
 * may perform the action. Registering RbacGuard alone would leave every route
 * effectively open, because it refuses only when a principal is missing a
 * permission — and without authentication there is no principal at all.
 *
 * Both are `APP_GUARD`, so protection is the default for every route in the
 * application and opting out requires an explicit `@Public()`.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    PrismaService,
    AuthService,
    PasswordProvider,
    {
      // Registered as a list so Azure AD can be added beside passwords without
      // touching AuthService.
      provide: AUTH_PROVIDERS,
      useFactory: (password: PasswordProvider) => [password],
      inject: [PasswordProvider],
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
  exports: [AuthService, PrismaService],
})
export class AuthModule {}
