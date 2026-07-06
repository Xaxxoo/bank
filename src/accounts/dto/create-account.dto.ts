import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ example: 'Amina Bello', description: 'Full name of the account holder' })
  @IsNotEmpty()
  @IsString()
  customer_name: string;

  @ApiProperty({ example: '08012345678', description: 'Nigerian phone number (local or E.164)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+?234|0)[789]\d{9}$/, {
    message: 'customer_phone must be a valid Nigerian phone number',
  })
  customer_phone: string;

  @ApiProperty({ example: 'amina@example.com' })
  @IsEmail()
  customer_email: string;

  @ApiProperty({ example: '12345678901', description: '11-digit Bank Verification Number' })
  @IsString()
  @Length(11, 11, { message: 'bvn must be exactly 11 digits' })
  @Matches(/^\d{11}$/, { message: 'bvn must contain only digits' })
  bvn: string;

  @ApiProperty({ example: 'ref-acc-001', description: 'Idempotency key — same reference returns the existing account' })
  @IsNotEmpty()
  @IsString()
  reference: string;
}
