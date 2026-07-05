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
import { VasService } from './vas.service';
import { PurchaseAirtimeDto } from './dto/purchase-airtime.dto';
import { PurchaseDataDto } from './dto/purchase-data.dto';
import { ListVasTransactionsDto } from './dto/list-vas-transactions.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UseApiKey, UseHmac, ApiClientContext } from '../auth/decorators/auth.decorator';
import { DataNetworkOperator } from '../providers/vtpass/vtpass.types';

/**
 * Matches the VAS endpoints from the PulseMFB Postman collection:
 *
 *   POST  /api/v1/external-api/vas/airtime
 *   GET   /api/v1/external-api/vas/data/bundles?operator=mtn-data
 *   POST  /api/v1/external-api/vas/data
 *   GET   /api/v1/external-api/vas/transactions/:reference
 *   GET   /api/v1/external-api/vas/transactions?limit=&type=
 */
@Controller('external-api/vas')
export class VasController {
  constructor(private readonly vasService: VasService) {}

  /**
   * Purchase airtime for a Nigerian mobile number.
   * Debits the debit_account_number and purchases via VTPass.
   */
  @Post('airtime')
  @HttpCode(HttpStatus.CREATED)
  @UseApiKey('vas:write')
  async purchaseAirtime(
    @Body() dto: PurchaseAirtimeDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.purchaseAirtime(dto, client);
    return {
      statusCode: 201,
      message: 'Airtime purchase successful',
      data,
    };
  }

  /**
   * Retrieve available data bundles for a network operator.
   * Requires HMAC signature per the Postman collection.
   *
   * Query: ?operator=mtn-data | glo-data | airtel-data | etisalat-data
   */
  @Get('data/bundles')
  @UseHmac('vas:read')
  async getDataBundles(
    @Query('operator') operator: DataNetworkOperator,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.getDataBundles(operator);
    return {
      statusCode: 200,
      message: 'Data bundles retrieved successfully',
      data,
    };
  }

  /**
   * Purchase a data bundle for a Nigerian mobile number.
   * Use GET /vas/data/bundles to get valid variation_codes first.
   */
  @Post('data')
  @HttpCode(HttpStatus.CREATED)
  @UseApiKey('vas:write')
  async purchaseData(
    @Body() dto: PurchaseDataDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.purchaseData(dto, client);
    return {
      statusCode: 201,
      message: 'Data purchase successful',
      data,
    };
  }

  /**
   * List VAS transactions for accounts owned by this API client.
   * Filter by type (airtime | data) and paginate with limit.
   */
  @Get('transactions')
  @UseApiKey('vas:read')
  async listTransactions(
    @Query() query: ListVasTransactionsDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.listVasTransactions(query, client);
    return {
      statusCode: 200,
      message: 'VAS transactions retrieved successfully',
      data,
    };
  }

  /**
   * Get a single VAS transaction by reference.
   */
  @Get('transactions/:reference')
  @UseApiKey('vas:read')
  async getTransaction(
    @Param('reference') reference: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.vasService.getVasTransaction(reference, client);
    return {
      statusCode: 200,
      message: 'VAS transaction retrieved successfully',
      data,
    };
  }
}
