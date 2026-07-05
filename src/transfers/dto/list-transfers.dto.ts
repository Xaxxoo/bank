import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionStatus } from '../../database/entities/transaction.entity';

/**
 * Matches GET /api/v1/external-api/transfers?limit=X&status=Y
 * from the PulseMFB Postman collection.
 */
export class ListTransfersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(TransactionStatus, {
    message: `status must be one of: ${Object.values(TransactionStatus).join(', ')}`,
  })
  status?: TransactionStatus;
}
