import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/**
 * Matches POST /api/v1/external-api/transfers/name-enquiry body
 * from the PulseMFB Postman collection.
 *
 * bankCode examples: '058' (GTB), '033' (UBA), '090713' (Moniepoint MFB)
 */
export class NameEnquiryDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be a 10-digit NUBAN' })
  accountNumber: string;

  @IsNotEmpty()
  @IsString()
  @Length(3, 6, { message: 'bankCode must be 3–6 digits' })
  @Matches(/^\d+$/, { message: 'bankCode must contain only digits' })
  bankCode: string;
}
