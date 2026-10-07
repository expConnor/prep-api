import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class RejectPurchaseRequestDto {
  @ApiProperty({ example: 'Over budget this quarter', maxLength: 2000 })
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(2000)
  reason: string;
}
