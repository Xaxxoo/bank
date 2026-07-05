import { IsArray, IsEnum, IsOptional, IsUrl } from 'class-validator';

export enum WebhookEvent {
  TRANSFER_COMPLETED = 'transfer.completed',
  TRANSFER_FAILED = 'transfer.failed',
  ACCOUNT_CREATED = 'account.created',
  VAS_COMPLETED = 'vas.completed',
  VAS_FAILED = 'vas.failed',
}

/**
 * Matches PATCH /external-api/webhooks body
 * from the PulseMFB Postman collection.
 */
export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true }, {
    message: 'webhook_url must be a valid HTTPS URL',
  })
  webhook_url?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(WebhookEvent, {
    each: true,
    message: `Each event must be one of: ${Object.values(WebhookEvent).join(', ')}`,
  })
  events?: WebhookEvent[];
}
