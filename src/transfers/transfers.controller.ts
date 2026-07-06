import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { NameEnquiryDto } from './dto/name-enquiry.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ListTransfersDto } from './dto/list-transfers.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UseApiKey, ApiClientContext } from '../auth/decorators/auth.decorator';

@ApiTags('Transfers')
@ApiSecurity('ApiKey')
@Controller('external-api/transfers')
@UseApiKey()
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post('name-enquiry')
  @HttpCode(HttpStatus.OK)
  @UseApiKey('transfers:read')
  @ApiOperation({ summary: 'Resolve account name before initiating a transfer (NIBSS NIP)' })
  @ApiResponse({ status: 200, description: 'Name enquiry successful' })
  async nameEnquiry(
    @Body() dto: NameEnquiryDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.nameEnquiry(dto);
    return { statusCode: 200, message: 'Name enquiry successful', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseApiKey('transfers:write')
  @ApiOperation({
    summary: 'Initiate a transfer',
    description:
      'Routes internally (instant) when beneficiary account exists in our system, ' +
      'otherwise routes via NIBSS NIP through Anchor.',
  })
  @ApiResponse({ status: 201, description: 'Transfer initiated successfully' })
  async initiateTransfer(
    @Body() dto: CreateTransferDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.initiateTransfer(dto, client);
    return { statusCode: 201, message: 'Transfer initiated successfully', data };
  }

  @Get()
  @UseApiKey('transfers:read')
  @ApiOperation({ summary: 'List transfers for this API client' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'processing', 'completed', 'failed', 'reversed'] })
  @ApiResponse({ status: 200, description: 'Transfers retrieved successfully' })
  async listTransfers(
    @Query() query: ListTransfersDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.listTransfers(query, client);
    return { statusCode: 200, message: 'Transfers retrieved successfully', data };
  }

  @Get(':reference')
  @UseApiKey('transfers:read')
  @ApiOperation({ summary: 'Get a transfer by reference (live-syncs status from Anchor if pending)' })
  @ApiParam({ name: 'reference', example: 'ref-txn-001' })
  @ApiResponse({ status: 200, description: 'Transfer retrieved successfully' })
  async getTransfer(
    @Param('reference') reference: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.getTransfer(reference, client);
    return { statusCode: 200, message: 'Transfer retrieved successfully', data };
  }

  @Patch(':reference/reverse')
  @HttpCode(HttpStatus.OK)
  @UseApiKey('transfers:write')
  @ApiOperation({
    summary: 'Reverse a completed transfer',
    description:
      'Creates reversal ledger entries and restores account balances. ' +
      'Only COMPLETED transfers can be reversed.',
  })
  @ApiParam({ name: 'reference', example: 'ref-txn-001' })
  @ApiResponse({ status: 200, description: 'Transfer reversed successfully' })
  @ApiResponse({ status: 400, description: 'Transfer is not in a reversible state' })
  async reverseTransfer(
    @Param('reference') reference: string,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.transfersService.reverseTransfer(reference, client);
    return { statusCode: 200, message: 'Transfer reversed successfully', data };
  }
}
