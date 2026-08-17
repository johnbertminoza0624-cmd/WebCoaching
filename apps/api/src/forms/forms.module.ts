import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FormsService } from './forms.service.js';
import { FormWriteService } from './form-write.service.js';
import { FormsController } from './forms.controller.js';

@Module({
  controllers: [FormsController],
  providers: [PrismaService, FormsService, FormWriteService],
  exports: [FormsService, FormWriteService],
})
export class FormsModule {}
