import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  // Emails are only unique per tenant, so login names the tenant explicitly.
  @ApiProperty({ example: 'acme' })
  @IsString()
  @IsNotEmpty()
  tenantSlug: string;

  @ApiProperty({ example: 'alice@acme.test' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;
}
