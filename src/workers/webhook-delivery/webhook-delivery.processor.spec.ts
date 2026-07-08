import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { ApiClient } from '../../database/entities/api-client.entity';
import { WebhookEvent } from '../../webhooks/dto/update-webhook.dto';

jest.mock('axios', () => ({
  default: { post: jest.fn() },
  post: jest.fn(),
}));

const mockRepo = () => ({
  findOne: jest.fn(),
});

const makeClient = (overrides: Partial<ApiClient> = {}): ApiClient =>
  ({
    id: 'client-1',
    webhook_url: 'https://example.com/webhook',
    webhook_events: [WebhookEvent.TRANSFER_COMPLETED, WebhookEvent.ACCOUNT_CREATED],
    private_key_hash: 'test-hash-secret',
    ...overrides,
  }) as ApiClient;

const makeJob = (data: { apiClientId: string; event: WebhookEvent; data: Record<string, any> }) =>
  ({
    data,
    attemptsMade: 1,
    opts: { attempts: 5 },
  }) as any;

describe('WebhookDeliveryProcessor', () => {
  let processor: WebhookDeliveryProcessor;
  let repo: ReturnType<typeof mockRepo>;
  let mockedPost: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedPost = axios.post as jest.Mock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryProcessor,
        { provide: getRepositoryToken(ApiClient), useFactory: mockRepo },
      ],
    }).compile();

    processor = module.get(WebhookDeliveryProcessor);
    repo = module.get(getRepositoryToken(ApiClient));
  });

  // ─── handleDelivery ───────────────────────────────────────────────────────

  describe('handleDelivery', () => {
    it('skips delivery when client is not found in the database', async () => {
      repo.findOne.mockResolvedValue(null);

      await processor.handleDelivery(
        makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: {} }),
      );

      expect(mockedPost).not.toHaveBeenCalled();
    });

    it('skips delivery when client has no webhook_url', async () => {
      repo.findOne.mockResolvedValue(makeClient({ webhook_url: null as any }));

      await processor.handleDelivery(
        makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: {} }),
      );

      expect(mockedPost).not.toHaveBeenCalled();
    });

    it('skips delivery when event is not in webhook_events', async () => {
      repo.findOne.mockResolvedValue(
        makeClient({ webhook_events: [WebhookEvent.ACCOUNT_CREATED] }),
      );

      await processor.handleDelivery(
        makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: {} }),
      );

      expect(mockedPost).not.toHaveBeenCalled();
    });

    it('posts to the webhook URL with the correct event payload', async () => {
      const client = makeClient();
      repo.findOne.mockResolvedValue(client);
      mockedPost.mockResolvedValue({ status: 200 });

      const eventData = { reference: 'ref-1', amount: 1000 };

      await processor.handleDelivery(
        makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: eventData }),
      );

      expect(mockedPost).toHaveBeenCalledWith(
        client.webhook_url,
        expect.objectContaining({
          event: WebhookEvent.TRANSFER_COMPLETED,
          data: eventData,
          timestamp: expect.any(String),
        }),
        expect.any(Object),
      );
    });

    it('sends x-pulsemfb-event and x-pulsemfb-signature headers', async () => {
      repo.findOne.mockResolvedValue(makeClient());
      mockedPost.mockResolvedValue({ status: 200 });

      await processor.handleDelivery(
        makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: {} }),
      );

      const headers = mockedPost.mock.calls[0][2].headers;
      expect(headers['x-pulsemfb-event']).toBe(WebhookEvent.TRANSFER_COMPLETED);
      expect(headers['x-pulsemfb-signature']).toEqual(expect.any(String));
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends a valid HMAC-SHA256 signature verifiable by the recipient', async () => {
      const client = makeClient({ private_key_hash: 'my-secret-hash' });
      repo.findOne.mockResolvedValue(client);
      mockedPost.mockResolvedValue({ status: 200 });

      await processor.handleDelivery(
        makeJob({
          apiClientId: 'client-1',
          event: WebhookEvent.TRANSFER_COMPLETED,
          data: { ref: 'ref-sig' },
        }),
      );

      const [, sentPayload, opts] = mockedPost.mock.calls[0];
      const sentSignature = opts.headers['x-pulsemfb-signature'];

      const expectedSignature = crypto
        .createHmac('sha256', 'my-secret-hash')
        .update(JSON.stringify(sentPayload))
        .digest('hex');

      expect(sentSignature).toBe(expectedSignature);
    });

    it('uses a 10-second timeout for delivery requests', async () => {
      repo.findOne.mockResolvedValue(makeClient());
      mockedPost.mockResolvedValue({ status: 200 });

      await processor.handleDelivery(
        makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: {} }),
      );

      const opts = mockedPost.mock.calls[0][2];
      expect(opts.timeout).toBe(10_000);
    });
  });

  // ─── onFailed ─────────────────────────────────────────────────────────────

  describe('onFailed', () => {
    it('does not throw when called with a failed delivery job', () => {
      expect(() =>
        processor.onFailed(
          makeJob({ apiClientId: 'client-1', event: WebhookEvent.TRANSFER_COMPLETED, data: {} }),
          new Error('Connection refused'),
        ),
      ).not.toThrow();
    });
  });
});
