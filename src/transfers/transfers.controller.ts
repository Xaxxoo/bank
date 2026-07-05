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
import { TransfersService } from './transfers.service';
import { NameEnquiryDto } from './dto/name-enquiry.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ListTransfersDto } from './dto/list-transfers.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UseApiKey, ApiClientContext } from '../auth/decorators/auth.decorator';

/**
 * Matches the External API endpoints from the PulseMFB Postman collection:
 *
 *   POST  /api/v1/external-api/transfers/name-enquiry
 *   POST  /api/v1/external-api/transfers
 *   GET   /api/v1/external-api/transfers/:reference
 *   GET   /api/v1/external-api/transfers?limit=X&status=Y
 *
 * All transfer endpoints use x-api-key auth per the Postman collection.
 * Transfers:write permission is required for mutations.
 */
@Controller('external-api/transfers')
@UseApiKey()                  // applied at controller level; permissions refined per route
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  /**
   * Resolve account name before initiating a transfer.
   * Routes through Anchor → NIBSS NIP name enquiry.
   */
  @Post('name-enquiry')
  @HttpCode(HttpStatus.OK)
  @UseApiKey('transfers:read')
  async nameEnquiry(
    @Body() dto: NameEnquiryDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.nameEnquiry(dto);
    return {
      statusCode: 200,
      message: 'Name enquiry successful',
      data,
    };
  }

  /**
   * Initiate an inter-bank transfer via NIBSS NIP.
   * Debits the debit_account_number and routes funds through Anchor.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseApiKey('transfers:write')
  async initiateTransfer(
    @Body() dto: CreateTransferDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.initiateTransfer(dto, client);
    return {
      statusCode: 201,
      message: 'Transfer initiated successfully',
      data,
    };
  }

  /**
   * List transfers for accounts owned by this API client.
   * Supports filtering by status and pagination via limit.
   */
  @Get()
  @UseApiKey('transfers:read')
  async listTransfers(
    @Query() query: ListTransfersDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.listTransfers(query, client);
    return {
      statusCode: 200,
      message: 'Transfers retrieved successfully',
      data,
    };
  }

  /**
   * Get a single transfer by its unique reference.
   * Syncs status live from Anchor if the transfer is still pending/processing.
   */
  @Get(':reference')
  @UseApiKey('transfers:read')
  async getTransfer(
    @Param('reference') reference: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.getTransfer(reference, client);
    return {
      statusCode: 200,
      message: 'Transfer retrieved successfully',
      data,
    };
  }
}
