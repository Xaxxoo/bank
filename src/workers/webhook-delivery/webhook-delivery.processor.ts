import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import * as Bull from 'bull';
import { ApiClient } from '../../database/entities/api-client.entity';
import { WebhookPayload } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/dto/update-webhook.dto';
import { WEBHOOK_DELIVERY_QUEUE } from '../../webhooks/webhooks.constants';

export interface WebhookJobData {
  apiClientId: string;
  event: WebhookEvent;
  data: Record<string, any>;
}

/**
 * Bull processor for queued webhook deliveries.
 *
 * Configured with 5 attempts and exponential backoff (5 s, 10 s, 20 s …)
 * so transient endpoint failures do not permanently lose events.
 *
 * Each job re-fetches the ApiClient from the DB in case the webhook URL
 * or event subscriptions changed between enqueue and delivery.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    @InjectRepository(ApiClient)
    private readonly apiClientRepo: Repository<ApiClient>,
  ) {}

  @Process()
  async handleDelivery(job: Bull.Job<WebhookJobData>): Promise<void> {
    const { apiClientId, event, data } = job.data;

    const apiClient = await this.apiClientRepo.findOne({ where: { id: apiClientId } });
    if (!apiClient?.webhook_url) return;
    if (!apiClient.webhook_events?.includes(event)) return;

    const payload: WebhookPayload = { event, data, timestamp: new Date().toISOString() };
    const body = JSON.stringify(payload);

    const signature = crypto
      .createHmac('sha256', apiClient.private_key_hash)
      .update(body)
      .digest('hex');

    await axios.post(apiClient.webhook_url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-pulsemfb-signature': signature,
        'x-pulsemfb-event': event,
      },
      timeout: 10_000,
    });

    this.logger.log(`Webhook delivered: ${event} → ${apiClient.webhook_url}`);
  }

  @OnQueueFailed()
  onFailed(job: Bull.Job<WebhookJobData>, err: Error): void {
    this.logger.warn(
      `Webhook failed (attempt ${job.attemptsMade}/${job.opts.attempts}) ` +
        `| client: ${job.data.apiClientId} | event: ${job.data.event} | error: ${err.message}`,
    );
  }
}
