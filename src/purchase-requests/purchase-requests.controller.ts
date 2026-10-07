import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard, type AuthUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

@ApiTags('purchase-requests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
@UseGuards(AuthGuard)
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly service: PurchaseRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a draft purchase request' })
  @ApiCreatedResponse({ description: 'Returns the new draft' })
  @ApiBadRequestResponse({ description: 'Invalid, missing or unknown fields' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePurchaseRequestDto,
  ) {
    return this.service.create(user, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a purchase request' })
  @ApiOkResponse({ description: 'Returns the purchase request' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description: "Doesn't exist, or the caller can't see it",
  })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(user, id);
  }
}
