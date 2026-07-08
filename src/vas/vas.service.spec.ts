import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VasService } from './vas.service';
import {
  Transaction,
  TransactionChannel,
  TransactionStatus,
} from '../database/entities/transaction.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { Account, AccountStatus } from '../database/entities/account.entity';
import { VTPassService } from '../providers/vtpass/vtpass.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/dto/update-webhook.dto';
import { ApiClient } from '../database/entities/api-client.entity';
import { DataNetworkOperator } from '../providers/vtpass/vtpass.types';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockVtpass = () => ({
  purchaseAirtime: jest.fn(),
  getDataBundles: jest.fn(),
  purchaseData: jest.fn(),
});

const mockWebhooks = () => ({ deliver: jest.fn() });

const mockDataSource = () => ({
  transaction: jest.fn((cb: any) => cb({ save: jest.fn(), update: jest.fn() })),
});

const CLIENT: ApiClient = { id: 'client-1', webhook_url: null, webhook_events: [] } as any;

const makeAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 'acc-1',
    account_number: '0123456789',
    api_client_id: CLIENT.id,
    status: AccountStatus.ACTIVE,
    balance_kobo: 500_000,
    ...overrides,
  }) as Account;

const makeTx = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    reference: 'ref-1',
    debit_account_number: '0123456789',
    amount_kobo: 100_000,
    status: TransactionStatus.COMPLETED,
    channel: TransactionChannel.VAS,
    created_at: new Date(),
    ...overrides,
  }) as Transaction;

describe('VasService', () => {
  let service: VasService;
  let txRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let vtpass: ReturnType<typeof mockVtpass>;
  let webhooks: ReturnType<typeof mockWebhooks>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VasService,
        { provide: getRepositoryToken(Transaction), useFactory: mockRepo },
        { provide: getRepositoryToken(LedgerEntry), useFactory: mockRepo },
        { provide: getRepositoryToken(Account), useFactory: mockRepo },
        { provide: VTPassService, useFactory: mockVtpass },
        { provide: WebhooksService, useFactory: mockWebhooks },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get(VasService);
    txRepo = module.get(getRepositoryToken(Transaction));
    accountRepo = module.get(getRepositoryToken(Account));
    vtpass = module.get(VTPassService);
    webhooks = module.get(WebhooksService);
  });

  const airtimeDto = {
    debit_account_number: '0123456789',
    operator: 'mtn' as any,
    phone: '08012345678',
    amount: 1000,
    reference: 'ref-1',
  };

  // ─── purchaseAirtime ──────────────────────────────────────────────────────

  describe('purchaseAirtime', () => {
    it('returns existing transaction on duplicate reference (idempotency)', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());

      const result = await service.purchaseAirtime(airtimeDto, CLIENT);
      expect(result.reference).toBe('ref-1');
      expect(vtpass.purchaseAirtime).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when debit account does not exist', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(null);

      await expect(service.purchaseAirtime(airtimeDto, CLIENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when account belongs to another client', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(makeAccount({ api_client_id: 'other-client' }));

      await expect(service.purchaseAirtime(airtimeDto, CLIENT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when account is not active', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(makeAccount({ status: AccountStatus.FROZEN }));

      await expect(service.purchaseAirtime(airtimeDto, CLIENT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws UnprocessableEntityException on insufficient balance', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(makeAccount({ balance_kobo: 50_000 }));

      await expect(
        service.purchaseAirtime({ ...airtimeDto, amount: 1000 }, CLIENT),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('completes purchase, settles ledger, and fires VAS_COMPLETED webhook', async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const completed = makeTx({ status: TransactionStatus.COMPLETED });

      txRepo.findOne
        .mockResolvedValueOnce(null)      // idempotency check
        .mockResolvedValueOnce(completed); // fetch after settlement
      accountRepo.findOne.mockResolvedValue(makeAccount());
      txRepo.create.mockReturnValue(pending);
      txRepo.save.mockResolvedValue(pending);
      vtpass.purchaseAirtime.mockResolvedValue({ code: '000', requestId: 'vt-1' });

      await service.purchaseAirtime(airtimeDto, CLIENT);

      expect(vtpass.purchaseAirtime).toHaveBeenCalledWith(
        airtimeDto.operator,
        airtimeDto.phone,
        airtimeDto.amount,
        airtimeDto.reference,
      );
      expect(webhooks.deliver).toHaveBeenCalledWith(
        CLIENT,
        WebhookEvent.VAS_COMPLETED,
        expect.any(Object),
      );
    });

    it('marks transaction FAILED and fires VAS_FAILED webhook when provider throws', async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const failed = makeTx({ status: TransactionStatus.FAILED });

      txRepo.findOne
        .mockResolvedValueOnce(null)   // idempotency check
        .mockResolvedValueOnce(failed); // fetch after failure update
      accountRepo.findOne.mockResolvedValue(makeAccount());
      txRepo.create.mockReturnValue(pending);
      txRepo.save.mockResolvedValue(pending);
      txRepo.update.mockResolvedValue(undefined);
      vtpass.purchaseAirtime.mockRejectedValue(new Error('VTPass error'));

      await expect(service.purchaseAirtime(airtimeDto, CLIENT)).rejects.toThrow('VTPass error');
      expect(txRepo.update).toHaveBeenCalledWith(
        pending.id,
        expect.objectContaining({ status: TransactionStatus.FAILED }),
      );
      expect(webhooks.deliver).toHaveBeenCalledWith(
        CLIENT,
        WebhookEvent.VAS_FAILED,
        expect.any(Object),
      );
    });
  });

  // ─── getDataBundles ───────────────────────────────────────────────────────

  describe('getDataBundles', () => {
    it('maps bundles from VTPass response', async () => {
      vtpass.getDataBundles.mockResolvedValue([
        { variation_code: 'mtn-1gb', name: '1GB', variation_amount: '300', fixedPrice: 'Yes' },
      ]);

      const result = await service.getDataBundles(DataNetworkOperator.MTN_DATA);

      expect(result).toEqual([
        { variation_code: 'mtn-1gb', name: '1GB', amount: 300, fixed_price: true },
      ]);
    });

    it('returns empty array when no bundles are available', async () => {
      vtpass.getDataBundles.mockResolvedValue([]);
      const result = await service.getDataBundles(DataNetworkOperator.MTN_DATA);
      expect(result).toEqual([]);
    });

    it('reflects fixed_price: false for non-fixed bundles', async () => {
      vtpass.getDataBundles.mockResolvedValue([
        { variation_code: 'glo-1gb', name: '1GB', variation_amount: '200', fixedPrice: 'No' },
      ]);

      const result = await service.getDataBundles(DataNetworkOperator.GLO_DATA);
      expect(result[0].fixed_price).toBe(false);
    });
  });

  // ─── purchaseData ─────────────────────────────────────────────────────────

  describe('purchaseData', () => {
    const dataDto = {
      debit_account_number: '0123456789',
      operator: DataNetworkOperator.MTN_DATA,
      phone: '08012345678',
      variation_code: 'mtn-1gb',
      amount: 300,
      reference: 'ref-data-1',
    };

    it('returns existing transaction on duplicate reference (idempotency)', async () => {
      const existing = makeTx({ reference: 'ref-data-1' });
      txRepo.findOne.mockResolvedValue(existing);

      const result = await service.purchaseData(dataDto, CLIENT);
      expect(result.reference).toBe('ref-data-1');
      expect(vtpass.purchaseData).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException on insufficient balance', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(makeAccount({ balance_kobo: 1_000 }));

      await expect(service.purchaseData(dataDto, CLIENT)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('completes purchase and fires VAS_COMPLETED webhook', async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const completed = makeTx();

      txRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(completed);
      accountRepo.findOne.mockResolvedValue(makeAccount());
      txRepo.create.mockReturnValue(pending);
      txRepo.save.mockResolvedValue(pending);
      vtpass.purchaseData.mockResolvedValue({ code: '000', requestId: 'vt-data-1' });

      await service.purchaseData(dataDto, CLIENT);

      expect(vtpass.purchaseData).toHaveBeenCalled();
      expect(webhooks.deliver).toHaveBeenCalledWith(
        CLIENT,
        WebhookEvent.VAS_COMPLETED,
        expect.any(Object),
      );
    });

    it('marks FAILED and fires VAS_FAILED webhook on provider error', async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const failed = makeTx({ status: TransactionStatus.FAILED });

      txRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(failed);
      accountRepo.findOne.mockResolvedValue(makeAccount());
      txRepo.create.mockReturnValue(pending);
      txRepo.save.mockResolvedValue(pending);
      txRepo.update.mockResolvedValue(undefined);
      vtpass.purchaseData.mockRejectedValue(new Error('Data purchase failed'));

      await expect(service.purchaseData(dataDto, CLIENT)).rejects.toThrow('Data purchase failed');
      expect(webhooks.deliver).toHaveBeenCalledWith(CLIENT, WebhookEvent.VAS_FAILED, expect.any(Object));
    });
  });

  // ─── getVasTransaction ────────────────────────────────────────────────────

  describe('getVasTransaction', () => {
    it('throws NotFoundException when transaction does not exist', async () => {
      txRepo.findOne.mockResolvedValue(null);

      await expect(service.getVasTransaction('ref-1', CLIENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when debit account does not belong to client', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      accountRepo.findOne.mockResolvedValue(null); // ownership check fails

      await expect(service.getVasTransaction('ref-1', CLIENT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns transaction when found and ownership is verified', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      accountRepo.findOne.mockResolvedValue(makeAccount());

      const result = await service.getVasTransaction('ref-1', CLIENT);
      expect(result.reference).toBe('ref-1');
    });
  });

  // ─── listVasTransactions ──────────────────────────────────────────────────

  describe('listVasTransactions', () => {
    it('returns empty result when client has no accounts', async () => {
      accountRepo.find.mockResolvedValue([]);

      const result = await service.listVasTransactions({ page: 1, limit: 20 }, CLIENT);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('returns paginated transactions with correct meta', async () => {
      accountRepo.find.mockResolvedValue([{ account_number: '0123456789' }]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[makeTx()], 1]),
      };
      txRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.listVasTransactions({ page: 1, limit: 20 }, CLIENT);
      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({ total: 1, page: 1, limit: 20, pages: 1 });
    });

    it('applies type filter when dto.type is provided', async () => {
      accountRepo.find.mockResolvedValue([{ account_number: '0123456789' }]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      txRepo.createQueryBuilder.mockReturnValue(mockQb);

      await service.listVasTransactions({ page: 1, limit: 20, type: 'airtime' as any }, CLIENT);
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.any(Object),
      );
    });
  });
});
