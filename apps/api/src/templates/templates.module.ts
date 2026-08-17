import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TemplatesService } from './templates.service.js';
import { TemplatesController } from './templates.controller.js';

@Module({
  controllers: [TemplatesController],
  providers: [PrismaService, TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
