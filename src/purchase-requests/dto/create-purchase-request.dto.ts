import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  IsUppercase,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePurchaseRequestDto {
  @ApiProperty({ example: 'Laptop for new hire', maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'title must not be blank' })
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    type: String,
    example: '14-inch, 32 GB RAM',
    maxLength: 2000,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ example: 'Dell', maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'vendor must not be blank' })
  @MaxLength(200)
  vendor: string;

  // Minor units so money stays exact; capped at the largest value the
  // 32-bit column holds so an oversized amount is a 400, not a database error.
  @ApiProperty({
    description: 'Amount in minor units, e.g. cents',
    example: 129900,
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  amount: number;

  @ApiProperty({ description: 'ISO 4217 currency code', example: 'EUR' })
  @IsUppercase()
  @IsISO4217CurrencyCode()
  currency: string;
}
