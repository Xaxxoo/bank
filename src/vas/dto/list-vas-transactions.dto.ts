import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum VasType {
  AIRTIME = 'airtime',
  DATA = 'data',
}

/**
 * Matches GET /api/v1/external-api/vas/transactions?limit=&type=
 * from the PulseMFB Postman collection.
 */
export class ListVasTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(VasType, { message: 'type must be one of: airtime, data' })
  type?: VasType;
}
