import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { FormsModule } from './forms/forms.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UsersModule } from './users/users.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

/**
 * Root module.
 *
 * `AuthModule` registers `JwtAuthGuard` and `RbacGuard` as global guards, so
 * every route is authenticated and permission-checked by default and opting
 * out requires an explicit `@Public()`.
 *
 * Prisma-backed modules need a reachable Postgres at bootstrap
 * (`PrismaService.onModuleInit` calls `$connect()`), so `pnpm infra:up` and
 * `pnpm db:migrate` must have run first.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule, FormsModule, TemplatesModule, UsersModule, UploadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
