import { PartialType } from '@nestjs/swagger';
import { CreatePurchaseRequestDto } from './create-purchase-request.dto.js';

export class UpdatePurchaseRequestDto extends PartialType(
  CreatePurchaseRequestDto,
) {}
