import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';

class CreateApiClientDto {
  @ApiProperty({ example: 'Acme Fintech Ltd' })
  @IsNotEmpty()
  @IsString()
  business_name: string;

  @ApiProperty({ example: 'ops@acmefintech.com' })
  @IsEmail()
  business_email: string;

  @ApiProperty({
    example: ['accounts:write', 'transfers:write', 'vas:write'],
    required: false,
    description: 'Granular permission scopes granted to this client',
  })
  @IsArray()
  @IsOptional()
  permissions?: string[];
}

/**
 * Internal-only endpoint for provisioning API clients.
 * In production, protect this with an internal network policy or admin token.
 */
@ApiTags('Internal')
@Controller('internal/clients')
export class ApiClientController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Provision a new API client',
    description: 'Returns api_key, public_key, and private_key. The private_key is shown once — store it securely.',
  })
  @ApiResponse({ status: 201, description: 'API client created' })
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
