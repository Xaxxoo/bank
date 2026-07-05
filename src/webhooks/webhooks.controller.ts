import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UseApiKey, ApiClientContext } from '../auth/decorators/auth.decorator';

/**
 * Matches the Webhooks endpoints from the PulseMFB Postman collection:
 *
 *   GET   /api/v1/external-api/webhooks
 *   PATCH /api/v1/external-api/webhooks
 */
@Controller('external-api/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Retrieve the current webhook configuration for this API client.
   */
  @Get()
  @UseApiKey('webhooks:read')
  getWebhookConfig(@ApiClientContext() client: ApiClient) {
    const data = this.webhooksService.getWebhookConfig(client);
    return {
      statusCode: 200,
      message: 'Webhook configuration retrieved',
      data,
    };
  }

  /**
   * Update the webhook URL and/or subscribed events.
   * Partial updates are supported — only provided fields are changed.
   *
   * Available events:
   *   transfer.completed | transfer.failed
   *   account.created
   *   vas.completed | vas.failed
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @UseApiKey('webhooks:write')
  async updateWebhookConfig(
    @Body() dto: UpdateWebhookDto,
    @ApiClientContext() client: ApiClient,
  ) {
    const data = await this.webhooksService.updateWebhookConfig(dto, client);
    return {
      statusCode: 200,
      message: 'Webhook configuration updated',
      data,
    };
  }
}
