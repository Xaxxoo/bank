import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsPositive, IsString, Min, Matches } from 'class-validator';
import { DataNetworkOperator } from '../../providers/vtpass/vtpass.types';

export class PurchaseDataDto {
  @ApiProperty({ example: '0123456789', description: '10-digit NUBAN account to debit' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'debit_account_number must be a 10-digit NUBAN' })
  debit_account_number: string;

  @ApiProperty({ enum: DataNetworkOperator, example: DataNetworkOperator.MTN_DATA })
  @IsEnum(DataNetworkOperator, {
    message: 'operator must be one of: mtn-data, glo-data, airtel-data, etisalat-data',
  })
  operator: DataNetworkOperator;

  @ApiProperty({ example: '08012345678', description: 'Recipient Nigerian phone number' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+?234|0)[789]\d{9}$/, {
    message: 'phone must be a valid Nigerian phone number',
  })
  phone: string;

  @ApiProperty({ example: 'mtn-10mb-100', description: 'Bundle code from GET /vas/data/bundles' })
  @IsNotEmpty()
  @IsString()
  variation_code: string;

  @ApiProperty({ example: 500, description: 'Bundle amount in Naira (min ₦50)' })
  @IsInt({ message: 'amount must be a whole number in Naira' })
  @IsPositive()
  @Min(50, { message: 'Minimum data purchase is ₦50' })
  amount: number;

  @ApiProperty({ example: 'ref-data-001', description: 'Unique idempotency key' })
  @IsNotEmpty()
  @IsString()
  reference: string;
}
