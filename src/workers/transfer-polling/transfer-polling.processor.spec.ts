import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { DataSource } from 'typeorm';
import {
  TransferPollingProcessor,
  TRANSFER_POLLING_QUEUE,
} from './transfer-polling.processor';
import {
  Transaction,
  TransactionChannel,
  TransactionStatus,
} from '../../database/entities/transaction.entity';
import { LedgerEntry, EntryType } from '../../database/entities/ledger-entry.entity';
import { Account } from '../../database/entities/account.entity';
import { ApiClient } from '../../database/entities/api-client.entity';
import { AnchorService } from '../../providers/anchor/anchor.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { TransfersService } from '../../transfers/transfers.service';
import { WebhookEvent } from '../../webhooks/dto/update-webhook.dto';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const mockPollingQueue = () => ({
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
});

const mockAnchor = () => ({ getTransfer: jest.fn() });
const mockWebhooks = () => ({ deliver: jest.fn() });
const mockTransfersService = () => ({
  mapAnchorStatus: jest.fn(),
  toTransferResponse: jest.fn().mockReturnValue({ reference: 'ref-1' }),
});
const mockDataSource = () => ({
  transaction: jest.fn((cb: any) => cb({ save: jest.fn(), update: jest.fn() })),
});

const makeTx = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    reference: 'ref-1',
    debit_account_number: '0123456789',
    amount_kobo: 100_000,
    status: TransactionStatus.PENDING,
    channel: TransactionChannel.NIBSS,
    provider_reference: 'anchor-tr-1',
    nibss_session_id: null,
    ...overrides,
  }) as Transaction;

const makeAccount = (): Account =>
  ({
    id: 'acc-1',
    account_number: '0123456789',
    api_client_id: 'client-1',
    balance_kobo: 500_000,
  }) as Account;

const makeClient = (): ApiClient =>
  ({
    id: 'client-1',
    webhook_url: null,
    webhook_events: [],
  }) as any;

describe('TransferPollingProcessor', () => {
  let processor: TransferPollingProcessor;
  let txRepo: ReturnType<typeof mockRepo>;
  let ledgerRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let apiClientRepo: ReturnType<typeof mockRepo>;
  let pollingQueue: ReturnType<typeof mockPollingQueue>;
  let anchor: ReturnType<typeof mockAnchor>;
  let webhooks: ReturnType<typeof mockWebhooks>;
  let transfersService: ReturnType<typeof mockTransfersService>;
  let dataSource: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferPollingProcessor,
        { provide: getQueueToken(TRANSFER_POLLING_QUEUE), useFactory: mockPollingQueue },
        { provide: getRepositoryToken(Transaction), useFactory: mockRepo },
        { provide: getRepositoryToken(LedgerEntry), useFactory: mockRepo },
        { provide: getRepositoryToken(Account), useFactory: mockRepo },
        { provide: getRepositoryToken(ApiClient), useFactory: mockRepo },
        { provide: AnchorService, useFactory: mockAnchor },
        { provide: WebhooksService, useFactory: mockWebhooks },
        { provide: TransfersService, useFactory: mockTransfersService },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    processor = module.get(TransferPollingProcessor);
    txRepo = module.get(getRepositoryToken(Transaction));
    ledgerRepo = module.get(getRepositoryToken(LedgerEntry));
    accountRepo = module.get(getRepositoryToken(Account));
    apiClientRepo = module.get(getRepositoryToken(ApiClient));
    pollingQueue = module.get(getQueueToken(TRANSFER_POLLING_QUEUE));
    anchor = module.get(AnchorService);
    webhooks = module.get(WebhooksService);
    transfersService = module.get(TransfersService);
    dataSource = module.get(DataSource);
  });

  // ─── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('removes stale repeatable jobs matching the poll job name', async () => {
      pollingQueue.getRepeatableJobs.mockResolvedValue([
        { name: 'poll-pending-transfers', key: 'stale-key' },
        { name: 'other-job', key: 'other-key' },
      ]);

      await processor.onModuleInit();

      expect(pollingQueue.removeRepeatableByKey).toHaveBeenCalledWith('stale-key');
      expect(pollingQueue.removeRepeatableByKey).not.toHaveBeenCalledWith('other-key');
    });

    it('schedules the repeatable polling job every 30 seconds', async () => {
      await processor.onModuleInit();

      expect(pollingQueue.add).toHaveBeenCalledWith(
        'poll-pending-transfers',
        {},
        expect.objectContaining({ repeat: { every: 30_000 } }),
      );
    });

    it('does not call removeRepeatableByKey when no stale jobs exist', async () => {
      pollingQueue.getRepeatableJobs.mockResolvedValue([]);
      await processor.onModuleInit();
      expect(pollingQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    });
  });

  // ─── pollPendingTransfers ─────────────────────────────────────────────────

  describe('pollPendingTransfers', () => {
    it('does nothing when no pending NIBSS transactions exist', async () => {
      txRepo.find.mockResolvedValue([]);
      await processor.pollPendingTransfers({} as any);
      expect(anchor.getTransfer).not.toHaveBeenCalled();
    });

    it('calls reconcileOne for each pending transaction', async () => {
      txRepo.find.mockResolvedValue([
        makeTx({ id: 'tx-1', reference: 'ref-1' }),
        makeTx({ id: 'tx-2', reference: 'ref-2', provider_reference: 'anchor-tr-2' }),
      ]);
      anchor.getTransfer.mockResolvedValue({ attributes: { status: 'PENDING' } });
      transfersService.mapAnchorStatus.mockReturnValue(TransactionStatus.PENDING);

      await processor.pollPendingTransfers({} as any);

      expect(anchor.getTransfer).toHaveBeenCalledTimes(2);
    });
  });

  // ─── reconciliation logic (via pollPendingTransfers) ──────────────────────

  describe('reconciliation logic', () => {
    it('skips transaction with no provider_reference', async () => {
      txRepo.find.mockResolvedValue([makeTx({ provider_reference: undefined })]);

      await processor.pollPendingTransfers({} as any);

      expect(anchor.getTransfer).not.toHaveBeenCalled();
    });

    it('skips DB update when the status has not changed', async () => {
      txRepo.find.mockResolvedValue([makeTx({ status: TransactionStatus.PROCESSING })]);
      anchor.getTransfer.mockResolvedValue({ attributes: { status: 'PROCESSING' } });
      transfersService.mapAnchorStatus.mockReturnValue(TransactionStatus.PROCESSING);

      await processor.pollPendingTransfers({} as any);

      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it('updates to intermediate status without running a DB transaction', async () => {
      txRepo.find.mockResolvedValue([makeTx({ status: TransactionStatus.PENDING })]);
      anchor.getTransfer.mockResolvedValue({
        attributes: { status: 'PROCESSING', sessionId: 'sess-1' },
      });
      transfersService.mapAnchorStatus.mockReturnValue(TransactionStatus.PROCESSING);

      await processor.pollPendingTransfers({} as any);

      expect(txRepo.update).toHaveBeenCalledWith(
        'tx-1',
        expect.objectContaining({ status: TransactionStatus.PROCESSING }),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('marks COMPLETED, runs a DB transaction, and fires transfer.completed webhook', async () => {
      txRepo.find.mockResolvedValue([makeTx()]);
      anchor.getTransfer.mockResolvedValue({
        attributes: { status: 'SUCCESSFUL', sessionId: 'sess-ok' },
      });
      transfersService.mapAnchorStatus.mockReturnValue(TransactionStatus.COMPLETED);
      accountRepo.findOne.mockResolvedValue(makeAccount());
      apiClientRepo.findOne.mockResolvedValue(makeClient());
      txRepo.findOne.mockResolvedValue(makeTx({ status: TransactionStatus.COMPLETED }));

      await processor.pollPendingTransfers({} as any);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(webhooks.deliver).toHaveBeenCalledWith(
        expect.any(Object),
        WebhookEvent.TRANSFER_COMPLETED,
        expect.any(Object),
      );
    });

    it('reverses the debit ledger on FAILED and fires transfer.failed webhook', async () => {
      txRepo.find.mockResolvedValue([makeTx()]);
      anchor.getTransfer.mockResolvedValue({
        attributes: { status: 'FAILED', responseMessage: 'Limit exceeded' },
      });
      transfersService.mapAnchorStatus.mockReturnValue(TransactionStatus.FAILED);

      ledgerRepo.findOne.mockResolvedValue({
        account_id: 'acc-1',
        amount_kobo: 100_000,
        type: EntryType.DEBIT,
        transaction_id: 'tx-1',
      });
      accountRepo.findOne.mockResolvedValue(makeAccount());
      apiClientRepo.findOne.mockResolvedValue(makeClient());
      txRepo.findOne.mockResolvedValue(makeTx({ status: TransactionStatus.FAILED }));

      await processor.pollPendingTransfers({} as any);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(webhooks.deliver).toHaveBeenCalledWith(
        expect.any(Object),
        WebhookEvent.TRANSFER_FAILED,
        expect.any(Object),
      );
    });

    it('handles FAILED with no prior debit entry without throwing', async () => {
      txRepo.find.mockResolvedValue([makeTx()]);
      anchor.getTransfer.mockResolvedValue({
        attributes: { status: 'FAILED', responseMessage: 'Error' },
      });
      transfersService.mapAnchorStatus.mockReturnValue(TransactionStatus.FAILED);
      ledgerRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(makeAccount());
      apiClientRepo.findOne.mockResolvedValue(makeClient());
      txRepo.findOne.mockResolvedValue(makeTx({ status: TransactionStatus.FAILED }));

      await expect(processor.pollPendingTransfers({} as any)).resolves.not.toThrow();
    });

    it('logs a warning and continues when Anchor API throws', async () => {
      txRepo.find.mockResolvedValue([makeTx()]);
      anchor.getTransfer.mockRejectedValue(new Error('Anchor unreachable'));

      await expect(processor.pollPendingTransfers({} as any)).resolves.not.toThrow();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  // ─── onFailed ─────────────────────────────────────────────────────────────

  describe('onFailed', () => {
    it('does not throw when called with a failed polling job', () => {
      expect(() =>
        processor.onFailed({} as any, new Error('Job timed out')),
      ).not.toThrow();
    });
  });
});
