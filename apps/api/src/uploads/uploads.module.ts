import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from './uploads.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  controllers: [UploadsController],
  providers: [PrismaService, UploadsService],
})
export class UploadsModule {}
