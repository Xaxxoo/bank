import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Matches POST /api/v1/external-api/accounts/prefix request body
 * from the PulseMFB Postman collection.
 */
export class CreateAccountDto {
  @IsNotEmpty()
  @IsString()
  customer_name: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+?234|0)[789]\d{9}$/, {
    message: 'customer_phone must be a valid Nigerian phone number',
  })
  customer_phone: string;

  @IsEmail()
  customer_email: string;

  @IsString()
  @Length(11, 11, { message: 'bvn must be exactly 11 digits' })
  @Matches(/^\d{11}$/, { message: 'bvn must contain only digits' })
  bvn: string;

  @IsNotEmpty()
  @IsString()
  reference: string;
}
