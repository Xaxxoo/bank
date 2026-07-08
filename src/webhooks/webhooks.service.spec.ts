import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { WebhooksService } from './webhooks.service';
import { ApiClient } from '../database/entities/api-client.entity';
import { WebhookEvent } from './dto/update-webhook.dto';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';

const mockRepo = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockQueue = () => ({
  add: jest.fn(),
});

const makeClient = (overrides: Partial<ApiClient> = {}): ApiClient =>
  ({
    id: 'client-1',
    webhook_url: 'https://example.com/webhook',
    webhook_events: [WebhookEvent.TRANSFER_COMPLETED, WebhookEvent.ACCOUNT_CREATED],
    ...overrides,
  }) as ApiClient;

describe('WebhooksService', () => {
  let service: WebhooksService;
  let repo: ReturnType<typeof mockRepo>;
  let queue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: getRepositoryToken(ApiClient), useFactory: mockRepo },
        { provide: getQueueToken(WEBHOOK_DELIVERY_QUEUE), useFactory: mockQueue },
      ],
    }).compile();

    service = module.get(WebhooksService);
    repo = module.get(getRepositoryToken(ApiClient));
    queue = module.get(getQueueToken(WEBHOOK_DELIVERY_QUEUE));
  });

  // ─── getWebhookConfig ─────────────────────────────────────────────────────

  describe('getWebhookConfig', () => {
    it('returns webhook_url and events from the client', () => {
      const client = makeClient();
      const result = service.getWebhookConfig(client);

      expect(result).toEqual({
        webhook_url: 'https://example.com/webhook',
        events: [WebhookEvent.TRANSFER_COMPLETED, WebhookEvent.ACCOUNT_CREATED],
      });
    });

    it('returns null when webhook_url is not set', () => {
      const client = makeClient({ webhook_url: null as any });
      const result = service.getWebhookConfig(client);
      expect(result.webhook_url).toBeNull();
    });

    it('returns empty array when no events are subscribed', () => {
      const client = makeClient({ webhook_events: [] });
      const result = service.getWebhookConfig(client);
      expect(result.events).toEqual([]);
    });
  });

  // ─── updateWebhookConfig ──────────────────────────────────────────────────

  describe('updateWebhookConfig', () => {
    it('updates url and events and returns the new config', async () => {
      const updated = makeClient({
        webhook_url: 'https://new.example.com/hook',
        webhook_events: [WebhookEvent.TRANSFER_FAILED],
      });
      repo.update.mockResolvedValue(undefined);
      repo.findOne.mockResolvedValue(updated);

      const result = await service.updateWebhookConfig(
        { webhook_url: 'https://new.example.com/hook', events: [WebhookEvent.TRANSFER_FAILED] },
        makeClient(),
      );

      expect(result.webhook_url).toBe('https://new.example.com/hook');
      expect(result.events).toEqual([WebhookEvent.TRANSFER_FAILED]);
    });

    it('only includes provided fields in the update payload', async () => {
      const client = makeClient();
      const afterUpdate = makeClient({ webhook_url: 'https://updated.example.com/hook' });
      repo.update.mockResolvedValue(undefined);
      repo.findOne.mockResolvedValue(afterUpdate);

      await service.updateWebhookConfig(
        { webhook_url: 'https://updated.example.com/hook' },
        client,
      );

      const updatePayload = repo.update.mock.calls[0][1];
      expect(updatePayload).toHaveProperty('webhook_url');
      expect(updatePayload).not.toHaveProperty('webhook_events');
    });

    it('only includes events when events is provided', async () => {
      const client = makeClient();
      const afterUpdate = makeClient({ webhook_events: [WebhookEvent.VAS_COMPLETED] });
      repo.update.mockResolvedValue(undefined);
      repo.findOne.mockResolvedValue(afterUpdate);

      await service.updateWebhookConfig({ events: [WebhookEvent.VAS_COMPLETED] }, client);

      const updatePayload = repo.update.mock.calls[0][1];
      expect(updatePayload).toHaveProperty('webhook_events');
      expect(updatePayload).not.toHaveProperty('webhook_url');
    });
  });

  // ─── deliver ──────────────────────────────────────────────────────────────

  describe('deliver', () => {
    it('skips when client has no webhook_url', async () => {
      const client = makeClient({ webhook_url: null as any });
      await service.deliver(client, WebhookEvent.TRANSFER_COMPLETED, {});
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips when the event is not in webhook_events', async () => {
      const client = makeClient({ webhook_events: [WebhookEvent.ACCOUNT_CREATED] });
      await service.deliver(client, WebhookEvent.TRANSFER_COMPLETED, {});
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues a job when client has a url and subscribes to the event', async () => {
      const client = makeClient();
      await service.deliver(client, WebhookEvent.TRANSFER_COMPLETED, { ref: 'ref-1' });

      expect(queue.add).toHaveBeenCalledWith(
        { apiClientId: client.id, event: WebhookEvent.TRANSFER_COMPLETED, data: { ref: 'ref-1' } },
        expect.objectContaining({ attempts: 5, backoff: expect.any(Object) }),
      );
    });

    it('enqueues with removeOnComplete: true and removeOnFail: false', async () => {
      const client = makeClient();
      await service.deliver(client, WebhookEvent.TRANSFER_COMPLETED, {});

      const jobOptions = queue.add.mock.calls[0][1];
      expect(jobOptions.removeOnComplete).toBe(true);
      expect(jobOptions.removeOnFail).toBe(false);
    });
  });
});
