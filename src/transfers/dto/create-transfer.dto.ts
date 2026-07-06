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
 * Matches POST /api/v1/external-api/transfers body
 * from the PulseMFB Postman collection.
 *
 * amount is in NGN (Naira). Internally converted to kobo.
 * Minimum transfer: ₦1 (100 kobo).
 *
 * beneficiary_bank_code is optional. When the beneficiary account
 * number resolves to an account already in our system the transfer
 * is settled internally without going to NIBSS. In that case the
 * bank code is not required. If the beneficiary is external, the
 * service will reject the request if no bank code is provided.
 */
export class CreateTransferDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'debit_account_number must be a 10-digit NUBAN' })
  debit_account_number: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'beneficiary_account_number must be a 10-digit NUBAN' })
  beneficiary_account_number: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'beneficiary_bank_code must be 3–6 digits' })
  beneficiary_bank_code?: string;

  @IsInt({ message: 'amount must be a whole number in Naira' })
  @IsPositive()
  @Min(1, { message: 'Minimum transfer amount is ₦1' })
  amount: number;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  narration: string;

  @IsNotEmpty()
  @IsString()
  reference: string;
}
