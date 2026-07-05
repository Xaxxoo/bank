import { IsEnum, IsInt, IsNotEmpty, IsPositive, IsString, Min, Matches } from 'class-validator';
import { NetworkOperator } from '../../providers/vtpass/vtpass.types';

/**
 * Matches POST /api/v1/external-api/vas/airtime body
 * from the PulseMFB Postman collection.
 */
export class PurchaseAirtimeDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'debit_account_number must be a 10-digit NUBAN' })
  debit_account_number: string;

  @IsEnum(NetworkOperator, {
    message: 'operator must be one of: mtn, glo, airtel, etisalat',
  })
  operator: NetworkOperator;

  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+?234|0)[789]\d{9}$/, {
    message: 'phone must be a valid Nigerian phone number',
  })
  phone: string;

  @IsInt({ message: 'amount must be a whole number in Naira' })
  @IsPositive()
  @Min(50, { message: 'Minimum airtime purchase is ₦50' })
  amount: number;

  @IsNotEmpty()
  @IsString()
  reference: string;
}
