import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check the app and database are up' })
  @ApiOkResponse({ description: "Returns `{ status: 'ok', database: 'up' }`" })
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up' };
  }
}
