import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
import * as Bull from 'bull';
import { ApiClient } from '../database/entities/api-client.entity';
import { UpdateWebhookDto, WebhookEvent } from './dto/update-webhook.dto';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';
import { WebhookJobData } from '../workers/webhook-delivery/webhook-delivery.processor';

export interface WebhookPayload {
  event: WebhookEvent;
  data: Record<string, any>;
  timestamp: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(ApiClient)
    private readonly apiClientRepo: Repository<ApiClient>,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly webhookQueue: Bull.Queue<WebhookJobData>,
  ) {}

  // ─── GET /webhooks ─────────────────────────────────────────────────────────

  getWebhookConfig(apiClient: ApiClient) {
    return {
      webhook_url: apiClient.webhook_url ?? null,
      events: apiClient.webhook_events ?? [],
    };
  }

  // ─── PATCH /webhooks ───────────────────────────────────────────────────────

  async updateWebhookConfig(dto: UpdateWebhookDto, apiClient: ApiClient) {
    const updates: Partial<ApiClient> = {};

    if (dto.webhook_url !== undefined) updates.webhook_url = dto.webhook_url;
    if (dto.events !== undefined) updates.webhook_events = dto.events;

    await this.apiClientRepo.update(apiClient.id, updates);

    const updated = await this.apiClientRepo.findOne({ where: { id: apiClient.id } });

    return {
      webhook_url: updated!.webhook_url ?? null,
      events: updated!.webhook_events ?? [],
    };
  }

  // ─── Webhook Delivery (called internally after events) ────────────────────

  /**
   * Enqueues a webhook delivery job for the given event.
   *
   * The job is processed by WebhookDeliveryProcessor with 5 attempts and
   * exponential backoff so transient endpoint failures are automatically
   * retried without blocking the caller.
   *
   * Silently skips if the client has no webhook URL or has not subscribed
   * to this event type.
   */
  async deliver(
    apiClient: ApiClient,
    event: WebhookEvent,
    data: Record<string, any>,
  ): Promise<void> {
    if (!apiClient.webhook_url) return;
    if (!apiClient.webhook_events?.includes(event)) return;

    await this.webhookQueue.add(
      { apiClientId: apiClient.id, event, data },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(`Webhook job queued: ${event} → client ${apiClient.id}`);
  }
}
