import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsPositive, IsString, Min, Matches } from 'class-validator';
import { NetworkOperator } from '../../providers/vtpass/vtpass.types';

export class PurchaseAirtimeDto {
  @ApiProperty({ example: '0123456789', description: '10-digit NUBAN account to debit' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'debit_account_number must be a 10-digit NUBAN' })
  debit_account_number: string;

  @ApiProperty({ enum: NetworkOperator, example: NetworkOperator.MTN })
  @IsEnum(NetworkOperator, {
    message: 'operator must be one of: mtn, glo, airtel, etisalat',
  })
  operator: NetworkOperator;

  @ApiProperty({ example: '08012345678', description: 'Recipient Nigerian phone number' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+?234|0)[789]\d{9}$/, {
    message: 'phone must be a valid Nigerian phone number',
  })
  phone: string;

  @ApiProperty({ example: 100, description: 'Airtime amount in Naira (min ₦50)' })
  @IsInt({ message: 'amount must be a whole number in Naira' })
  @IsPositive()
  @Min(50, { message: 'Minimum airtime purchase is ₦50' })
  amount: number;

  @ApiProperty({ example: 'ref-airtime-001', description: 'Unique idempotency key' })
  @IsNotEmpty()
  @IsString()
  reference: string;
}
