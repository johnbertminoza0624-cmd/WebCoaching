import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [UsersController],
  providers: [PrismaService, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
