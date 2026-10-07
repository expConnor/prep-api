import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard, type AuthUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ChangeRoleDto } from './dto/change-role.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List the users in the caller's tenant" })
  @ApiOkResponse({ description: 'Returns the users, ordered by email' })
  @ApiForbiddenResponse({ description: 'The caller is not an admin' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post()
  @ApiOperation({ summary: "Create a user in the caller's tenant" })
  @ApiCreatedResponse({ description: 'Returns the new user' })
  @ApiBadRequestResponse({ description: 'Invalid, missing or unknown fields' })
  @ApiForbiddenResponse({ description: 'The caller is not an admin' })
  @ApiConflictResponse({
    description: 'The email is already used in this tenant',
  })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateUserDto) {
    return this.service.create(user, body);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: "Change another user's role" })
  @ApiOkResponse({ description: 'Returns the updated user' })
  @ApiBadRequestResponse({
    description: 'The id is not a UUID, or the role is missing or unknown',
  })
  @ApiForbiddenResponse({
    description: 'The caller is not an admin, or is changing their own role',
  })
  @ApiNotFoundResponse({ description: "No such user in the caller's tenant" })
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeRoleDto,
  ) {
    return this.service.changeRole(user, id, body.role);
  }
}
