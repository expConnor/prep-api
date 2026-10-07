import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard, type AuthUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from './audit.service.js';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query.js';

@ApiTags('audit-logs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
@UseGuards(AuthGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @ApiOperation({ summary: "List the audit log of the caller's tenant" })
  @ApiOkResponse({
    description:
      'Returns `{ items, total, page, limit }`, newest first, each entry with `{ before, after }` snapshots in `changes`',
  })
  @ApiBadRequestResponse({ description: 'Invalid or unknown query parameters' })
  @ApiForbiddenResponse({ description: 'The caller is not an admin' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListAuditLogsQuery) {
    return this.service.list(user, query);
  }
}
