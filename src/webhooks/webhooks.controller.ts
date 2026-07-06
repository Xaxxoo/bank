import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UseApiKey, ApiClientContext } from '../auth/decorators/auth.decorator';

@ApiTags('Webhooks')
@ApiSecurity('ApiKey')
@Controller('external-api/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @UseApiKey('webhooks:read')
  @ApiOperation({ summary: 'Get the current webhook configuration for this API client' })
  @ApiResponse({ status: 200, description: 'Webhook configuration retrieved' })
  getWebhookConfig(@ApiClientContext() client: ApiClient) {
    const data = this.webhooksService.getWebhookConfig(client);
    return { statusCode: 200, message: 'Webhook configuration retrieved', data };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @UseApiKey('webhooks:write')
  @ApiOperation({
    summary: 'Update webhook URL and/or subscribed events',
    description:
      'Partial updates supported. Available events: ' +
      'transfer.completed, transfer.failed, account.created, vas.completed, vas.failed',
  })
  @ApiResponse({ status: 200, description: 'Webhook configuration updated' })
  async updateWebhookConfig(
    @Body() dto: UpdateWebhookDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.webhooksService.updateWebhookConfig(dto, client);
    return { statusCode: 200, message: 'Webhook configuration updated', data };
  }
}
