import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum VasType {
  AIRTIME = 'airtime',
  DATA = 'data',
}

export class ListVasTransactionsDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: '1-indexed page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: VasType })
  @IsOptional()
  @IsEnum(VasType, { message: 'type must be one of: airtime, data' })
  type?: VasType;
}
