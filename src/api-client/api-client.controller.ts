import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';

class CreateApiClientDto {
  @IsNotEmpty()
  @IsString()
  business_name: string;

  @IsEmail()
  business_email: string;

  @IsArray()
  @IsOptional()
  permissions?: string[];
}

/**
 * Internal-only endpoint for provisioning API clients.
 * In production, protect this with an internal network policy or admin token.
 */
@Controller('internal/clients')
export class ApiClientController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateApiClientDto) {
    const result = await this.authService.createApiClient(
      dto.business_name,
      dto.business_email,
      dto.permissions,
    );

    return {
      statusCode: 201,
      message: 'API client created. Store the privateKey securely — it will not be shown again.',
      data: result,
    };
  }
}
