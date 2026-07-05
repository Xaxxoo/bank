import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { ApiClient } from '../database/entities/api-client.entity';
import { UpdateWebhookDto, WebhookEvent } from './dto/update-webhook.dto';

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
   * Delivers a webhook event to the API client's configured URL.
   * Signs the payload with HMAC-SHA256 using the client's private_key_hash
   * so the receiver can verify authenticity.
   *
   * Signature is sent in the `x-pulsemfb-signature` header.
   * Retry logic should be handled by the queue (BullMQ) in production.
   */
  async deliver(apiClient: ApiClient, event: WebhookEvent, data: Record<string, any>): Promise<void> {
    if (!apiClient.webhook_url) return;
    if (!apiClient.webhook_events?.includes(event)) return;

    const payload: WebhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', apiClient.private_key_hash)
      .update(body)
      .digest('hex');

    try {
      await axios.post(apiClient.webhook_url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-pulsemfb-signature': signature,
          'x-pulsemfb-event': event,
        },
        timeout: 10000,
      });

      this.logger.log(`Webhook delivered: ${event} → ${apiClient.webhook_url}`);
    } catch (err) {
      // Log failure but do not throw — webhook delivery is fire-and-forget.
      // A production system should enqueue retries via BullMQ.
      this.logger.warn(
        `Webhook delivery failed for client ${apiClient.id} | event: ${event} | error: ${err?.message}`,
      );
    }
  }
}
