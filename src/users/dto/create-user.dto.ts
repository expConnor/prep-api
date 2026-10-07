import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../generated/prisma/client.js';

export class CreateUserDto {
  @ApiProperty({ example: 'nina@acme.test' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Nina Novak', maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: 'Initial password, set by the admin',
    minLength: 8,
    example: 'correct horse',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: Role })
  @IsIn(Object.values(Role))
  role: Role;
}
