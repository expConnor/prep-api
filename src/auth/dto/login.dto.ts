import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  // Emails are only unique per tenant, so login names the tenant explicitly.
  @IsString()
  @IsNotEmpty()
  tenantSlug: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
