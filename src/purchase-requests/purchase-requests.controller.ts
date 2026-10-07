import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard, type AuthUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto.js';
import { RejectPurchaseRequestDto } from './dto/reject-purchase-request.dto.js';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto.js';
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

  @Patch(':id')
  @ApiOperation({ summary: 'Edit your own draft' })
  @ApiOkResponse({ description: 'Returns the updated request' })
  @ApiBadRequestResponse({
    description: 'The id is not a UUID, or invalid or unknown fields',
  })
  @ApiForbiddenResponse({ description: "The request isn't the caller's" })
  @ApiNotFoundResponse({
    description: "Doesn't exist, or the caller can't see it",
  })
  @ApiConflictResponse({ description: 'The request is no longer a draft' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePurchaseRequestDto,
  ) {
    return this.service.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete your own draft' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiForbiddenResponse({ description: "The request isn't the caller's" })
  @ApiNotFoundResponse({
    description: "Doesn't exist, or the caller can't see it",
  })
  @ApiConflictResponse({ description: 'The request is no longer a draft' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(user, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit your own draft for approval' })
  @ApiOkResponse({ description: 'Returns the submitted request' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiForbiddenResponse({ description: "The request isn't the caller's" })
  @ApiNotFoundResponse({
    description: "Doesn't exist, or the caller can't see it",
  })
  @ApiConflictResponse({ description: 'The request is no longer a draft' })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.submit(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: "Approve someone else's submitted request" })
  @ApiOkResponse({ description: 'Returns the approved request' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiForbiddenResponse({
    description: "The caller is a requester, or it's their own request",
  })
  @ApiNotFoundResponse({
    description: "Doesn't exist, or the caller can't see it",
  })
  @ApiConflictResponse({ description: 'The request is not submitted' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: "Reject someone else's submitted request" })
  @ApiOkResponse({ description: 'Returns the rejected request' })
  @ApiBadRequestResponse({
    description: 'The id is not a UUID, or the reason is missing or blank',
  })
  @ApiForbiddenResponse({
    description: "The caller is a requester, or it's their own request",
  })
  @ApiNotFoundResponse({
    description: "Doesn't exist, or the caller can't see it",
  })
  @ApiConflictResponse({ description: 'The request is not submitted' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectPurchaseRequestDto,
  ) {
    return this.service.reject(user, id, body.reason);
  }
}
