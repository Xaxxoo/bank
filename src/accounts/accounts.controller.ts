import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import {
  UseApiKey,
  UseHmac,
  ApiClientContext,
} from '../auth/decorators/auth.decorator';

@ApiTags('Accounts')
@Controller('external-api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post('prefix')
  @HttpCode(HttpStatus.CREATED)
  @UseHmac('accounts:write')
  @ApiSecurity('HmacPublicKey')
  @ApiSecurity('HmacSignature')
  @ApiSecurity('HmacTimestamp')
  @ApiOperation({ summary: 'Create a virtual sub-account (prefix type)' })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  async createPrefixAccount(
    @Body() dto: CreateAccountDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.createPrefixAccount(dto, client);
    return { statusCode: 201, message: 'Account created successfully', data };
  }

  @Get(':account_number/balance')
  @UseApiKey('accounts:read')
  @ApiSecurity('ApiKey')
  @ApiOperation({ summary: 'Get live balance for an account' })
  @ApiParam({ name: 'account_number', example: '0123456789' })
  @ApiResponse({ status: 200, description: 'Balance retrieved successfully' })
  async getBalance(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.getBalance(accountNumber, client);
    return { statusCode: 200, message: 'Balance retrieved successfully', data };
  }

  @Get(':account_number')
  @UseApiKey('accounts:read')
  @ApiSecurity('ApiKey')
  @ApiOperation({ summary: 'Get full account details' })
  @ApiParam({ name: 'account_number', example: '0123456789' })
  @ApiResponse({ status: 200, description: 'Account retrieved successfully' })
  async getAccount(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.getAccount(accountNumber, client);
    return { statusCode: 200, message: 'Account retrieved successfully', data };
  }

  @Patch(':account_number/freeze')
  @HttpCode(HttpStatus.OK)
  @UseHmac('accounts:write')
  @ApiSecurity('HmacPublicKey')
  @ApiSecurity('HmacSignature')
  @ApiSecurity('HmacTimestamp')
  @ApiOperation({ summary: 'Freeze an active account (blocks all debits and credits)' })
  @ApiParam({ name: 'account_number', example: '0123456789' })
  @ApiResponse({ status: 200, description: 'Account frozen successfully' })
  async freezeAccount(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.freezeAccount(accountNumber, client);
    return { statusCode: 200, message: 'Account frozen successfully', data };
  }

  @Patch(':account_number/unfreeze')
  @HttpCode(HttpStatus.OK)
  @UseHmac('accounts:write')
  @ApiSecurity('HmacPublicKey')
  @ApiSecurity('HmacSignature')
  @ApiSecurity('HmacTimestamp')
  @ApiOperation({ summary: 'Unfreeze a frozen account' })
  @ApiParam({ name: 'account_number', example: '0123456789' })
  @ApiResponse({ status: 200, description: 'Account unfrozen successfully' })
  async unfreezeAccount(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.unfreezeAccount(accountNumber, client);
    return { statusCode: 200, message: 'Account unfrozen successfully', data };
  }

  @Patch(':account_number/close')
  @HttpCode(HttpStatus.OK)
  @UseHmac('accounts:write')
  @ApiSecurity('HmacPublicKey')
  @ApiSecurity('HmacSignature')
  @ApiSecurity('HmacTimestamp')
  @ApiOperation({ summary: 'Permanently close an account (irreversible)' })
  @ApiParam({ name: 'account_number', example: '0123456789' })
  @ApiResponse({ status: 200, description: 'Account closed successfully' })
  async closeAccount(
    @Param('account_number') accountNumber: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.accountsService.closeAccount(accountNumber, client);
    return { statusCode: 200, message: 'Account closed successfully', data };
  }
}
