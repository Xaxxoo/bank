import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { VasService } from './vas.service';
import { PurchaseAirtimeDto } from './dto/purchase-airtime.dto';
import { PurchaseDataDto } from './dto/purchase-data.dto';
import { ListVasTransactionsDto } from './dto/list-vas-transactions.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UseApiKey, UseHmac, ApiClientContext } from '../auth/decorators/auth.decorator';
import { DataNetworkOperator } from '../providers/vtpass/vtpass.types';

@ApiTags('VAS')
@Controller('external-api/vas')
export class VasController {
  constructor(private readonly vasService: VasService) {}

  @Post('airtime')
  @HttpCode(HttpStatus.CREATED)
  @UseApiKey('vas:write')
  @ApiSecurity('ApiKey')
  @ApiOperation({ summary: 'Purchase airtime for a Nigerian mobile number' })
  @ApiResponse({ status: 201, description: 'Airtime purchase successful' })
  async purchaseAirtime(
    @Body() dto: PurchaseAirtimeDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.purchaseAirtime(dto, client);
    return { statusCode: 201, message: 'Airtime purchase successful', data };
  }

  @Get('data/bundles')
  @UseHmac('vas:read')
  @ApiSecurity('HmacPublicKey')
  @ApiSecurity('HmacSignature')
  @ApiSecurity('HmacTimestamp')
  @ApiOperation({ summary: 'List available data bundles for a network operator' })
  @ApiQuery({ name: 'operator', enum: DataNetworkOperator })
  @ApiResponse({ status: 200, description: 'Data bundles retrieved successfully' })
  async getDataBundles(
    @Query('operator') operator: DataNetworkOperator,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.getDataBundles(operator);
    return { statusCode: 200, message: 'Data bundles retrieved successfully', data };
  }

  @Post('data')
  @HttpCode(HttpStatus.CREATED)
  @UseApiKey('vas:write')
  @ApiSecurity('ApiKey')
  @ApiOperation({ summary: 'Purchase a data bundle for a Nigerian mobile number' })
  @ApiResponse({ status: 201, description: 'Data purchase successful' })
  async purchaseData(
    @Body() dto: PurchaseDataDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.purchaseData(dto, client);
    return { statusCode: 201, message: 'Data purchase successful', data };
  }

  @Get('transactions')
  @UseApiKey('vas:read')
  @ApiSecurity('ApiKey')
  @ApiOperation({ summary: 'List VAS transactions for this API client' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'type', required: false, enum: ['airtime', 'data'] })
  @ApiResponse({ status: 200, description: 'VAS transactions retrieved successfully' })
  async listTransactions(
    @Query() query: ListVasTransactionsDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.listVasTransactions(query, client);
    return { statusCode: 200, message: 'VAS transactions retrieved successfully', data };
  }

  @Get('transactions/:reference')
  @UseApiKey('vas:read')
  @ApiSecurity('ApiKey')
  @ApiOperation({ summary: 'Get a single VAS transaction by reference' })
  @ApiParam({ name: 'reference', example: 'ref-airtime-001' })
  @ApiResponse({ status: 200, description: 'VAS transaction retrieved successfully' })
  async getTransaction(
    @Param('reference') reference: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.getVasTransaction(reference, client);
    return { statusCode: 200, message: 'VAS transaction retrieved successfully', data };
  }
}
