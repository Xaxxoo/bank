import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class NameEnquiryDto {
  @ApiProperty({ example: '0123456789', description: '10-digit NUBAN account number' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be a 10-digit NUBAN' })
  accountNumber: string;

  @ApiProperty({ example: '058', description: 'CBN bank code (e.g. 058 = GTB, 033 = UBA)' })
  @IsNotEmpty()
  @IsString()
  @Length(3, 6, { message: 'bankCode must be 3–6 digits' })
  @Matches(/^\d+$/, { message: 'bankCode must contain only digits' })
  bankCode: string;
}
