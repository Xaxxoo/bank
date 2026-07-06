import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsPositive,
  Min,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Matches POST /api/v1/external-api/transfers body.
 *
 * amount is in NGN (Naira). Internally converted to kobo.
 * beneficiary_bank_code is optional when the beneficiary account exists
 * in our system (internal transfer). Required for external NIBSS transfers.
 */
export class CreateTransferDto {
  @ApiProperty({ example: '0123456789', description: '10-digit NUBAN account to debit' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'debit_account_number must be a 10-digit NUBAN' })
  debit_account_number: string;

  @ApiProperty({ example: '0987654321', description: '10-digit NUBAN of the beneficiary' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'beneficiary_account_number must be a 10-digit NUBAN' })
  beneficiary_account_number: string;

  @ApiPropertyOptional({
    example: '058',
    description: 'CBN bank code. Required for external banks; omit for internal transfers.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'beneficiary_bank_code must be 3–6 digits' })
  beneficiary_bank_code?: string;

  @ApiProperty({ example: 5000, description: 'Amount in Naira (whole numbers only)' })
  @IsInt({ message: 'amount must be a whole number in Naira' })
  @IsPositive()
  @Min(1, { message: 'Minimum transfer amount is ₦1' })
  amount: number;

  @ApiProperty({ example: 'School fees payment', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  narration: string;

  @ApiProperty({ example: 'ref-txn-001', description: 'Unique idempotency key for this transfer' })
  @IsNotEmpty()
  @IsString()
  reference: string;
}
