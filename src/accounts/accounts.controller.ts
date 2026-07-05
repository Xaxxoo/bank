import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import {
  UseApiKey,
  UseHmac,
  ApiClientContext,
} from '../auth/decorators/auth.decorator';

/**
 * Matches the External API endpoints from the PulseMFB Postman collection:
 *
 *   POST   /api/v1/external-api/accounts/prefix
 *   GET    /api/v1/external-api/accounts/:account_number/balance
 *   GET    /api/v1/external-api/accounts/:account_number
 */
@Controller('external-api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /**
   * Create a virtual sub-account (prefix type) for a customer.
   * Requires HMAC signature authentication.
   *
   * Headers: x-public-key, x-signature, x-timestamp
   * Body:    { customer_name, customer_phone, customer_email, bvn, reference }
   */
  @Post('prefix')
  @HttpCode(HttpStatus.CREATED)
  @UseHmac('accounts:write')
  async createPrefixAccount(
    @Body() dto: CreateAccountDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.createPrefixAccount(dto, client);
    return {
      statusCode: 201,
      message: 'Account created successfully',
      data,
    };
  }

  /**
   * Get the current balance for an account.
   * Requires API key authentication.
   *
   * Header: x-api-key
   */
  @Get(':account_number/balance')
  @UseApiKey('accounts:read')
  async getBalance(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.getBalance(accountNumber, client);
    return {
      statusCode: 200,
      message: 'Balance retrieved successfully',
      data,
    };
  }

  /**
   * Get full account details.
   * Requires API key authentication.
   *
   * Header: x-api-key
   */
  @Get(':account_number')
  @UseApiKey('accounts:read')
  async getAccount(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.getAccount(accountNumber, client);
    return {
      statusCode: 200,
      message: 'Account retrieved successfully',
      data,
    };
  }
}
