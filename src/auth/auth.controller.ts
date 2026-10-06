import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard, type AuthUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in and get an access token' })
  @ApiOkResponse({ description: 'Returns `{ accessToken }`' })
  @ApiBadRequestResponse({ description: 'Missing or unknown fields' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the logged-in user' })
  @ApiOkResponse({
    description: 'Returns `{ id, tenantId, email, name, role }`',
  })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }
}
