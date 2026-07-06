import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TransfersService } from './transfers.service';
import { Transaction, TransactionChannel, TransactionStatus } from '../database/entities/transaction.entity';
import { LedgerEntry, EntryType } from '../database/entities/ledger-entry.entity';
import { Account, AccountStatus } from '../database/entities/account.entity';
import { AnchorService } from '../providers/anchor/anchor.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ApiClient } from '../database/entities/api-client.entity';
import { WebhookEvent } from '../webhooks/dto/update-webhook.dto';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockAnchor = () => ({ nameEnquiry: jest.fn(), initiateTransfer: jest.fn(), getTransfer: jest.fn() });
const mockWebhooks = () => ({ deliver: jest.fn() });
const mockDataSource = () => ({ transaction: jest.fn((cb: any) => cb({ save: jest.fn(), update: jest.fn() })) });

const CLIENT: ApiClient = { id: 'client-1', webhook_url: null, webhook_events: [] } as any;

const makeAccount = (o: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  account_number: '0123456789',
  api_client_id: CLIENT.id,
  status: AccountStatus.ACTIVE,
  balance_kobo: 500_000,
  provider_account_id: 'anchor-acc-1',
  ...o,
} as Account);

const makeTx = (o: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  reference: 'ref-1',
  debit_account_number: '0123456789',
  credit_account_number: '0987654321',
  amount_kobo: 100_000,
  status: TransactionStatus.COMPLETED,
  channel: TransactionChannel.INTERNAL,
  ...o,
} as Transaction);

describe('TransfersService', () => {
  let service: TransfersService;
  let txRepo: ReturnType<typeof mockRepo>;
  let ledgerRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let anchor: ReturnType<typeof mockAnchor>;
  let webhooks: ReturnType<typeof mockWebhooks>;
  let dataSource: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: getRepositoryToken(Transaction), useFactory: mockRepo },
        { provide: getRepositoryToken(LedgerEntry), useFactory: mockRepo },
        { provide: getRepositoryToken(Account), useFactory: mockRepo },
        { provide: AnchorService, useFactory: mockAnchor },
        { provide: WebhooksService, useFactory: mockWebhooks },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get(TransfersService);
    txRepo = module.get(getRepositoryToken(Transaction));
    ledgerRepo = module.get(getRepositoryToken(LedgerEntry));
    accountRepo = module.get(getRepositoryToken(Account));
    anchor = module.get(AnchorService);
    webhooks = module.get(WebhooksService);
    dataSource = module.get(DataSource);
  });

  // ─── initiateTransfer ─────────────────────────────────────────────────────

  describe('initiateTransfer', () => {
    const dto = {
      debit_account_number: '0123456789',
      beneficiary_account_number: '0987654321',
      amount: 1000,
      narration: 'Test',
      reference: 'ref-1',
    };

    it('returns existing transaction on duplicate reference (idempotency)', async () => {
      const existing = makeTx();
      txRepo.findOne.mockResolvedValue(existing);

      const result = await service.initiateTransfer(dto, CLIENT);
      expect(result.reference).toBe('ref-1');
      expect(accountRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when debit account does not exist', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(null);

      await expect(service.initiateTransfer(dto, CLIENT)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when debit account belongs to another client', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(makeAccount({ api_client_id: 'other' }));

      await expect(service.initiateTransfer(dto, CLIENT)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws UnprocessableEntityException on insufficient balance', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne
        .mockResolvedValueOnce(makeAccount({ balance_kobo: 50_000 })) // debit account
        .mockResolvedValueOnce(null);                                   // credit account

      await expect(
        service.initiateTransfer({ ...dto, amount: 1000 }, CLIENT),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('routes internally when beneficiary account exists in DB', async () => {
      txRepo.findOne.mockResolvedValue(null);
      const debitAcc = makeAccount();
      const creditAcc = makeAccount({ id: 'acc-2', account_number: '0987654321', balance_kobo: 0 });

      accountRepo.findOne
        .mockResolvedValueOnce(debitAcc)   // debit account
        .mockResolvedValueOnce(creditAcc); // credit account (internal check)

      const settled = makeTx({ status: TransactionStatus.COMPLETED });
      txRepo.create.mockReturnValue(settled);
      txRepo.save.mockResolvedValue(settled);
      txRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(settled);

      const result = await service.initiateTransfer(dto, CLIENT);
      expect(result.status).toBe(TransactionStatus.COMPLETED);
      expect(anchor.initiateTransfer).not.toHaveBeenCalled();
      expect(webhooks.deliver).toHaveBeenCalledWith(CLIENT, WebhookEvent.TRANSFER_COMPLETED, expect.any(Object));
    });

    it('requires beneficiary_bank_code for external transfers', async () => {
      txRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne
        .mockResolvedValueOnce(makeAccount()) // debit account
        .mockResolvedValueOnce(null);          // credit account not in our DB

      await expect(
        service.initiateTransfer({ ...dto, beneficiary_bank_code: undefined }, CLIENT),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── reverseTransfer ──────────────────────────────────────────────────────

  describe('reverseTransfer', () => {
    it('throws NotFoundException when transfer does not exist', async () => {
      txRepo.findOne.mockResolvedValue(null);
      await expect(service.reverseTransfer('bad-ref', CLIENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when transfer is already reversed', async () => {
      txRepo.findOne.mockResolvedValue(makeTx({ status: TransactionStatus.REVERSED }));
      accountRepo.findOne.mockResolvedValue(makeAccount());

      await expect(service.reverseTransfer('ref-1', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when transfer is still pending', async () => {
      txRepo.findOne.mockResolvedValue(makeTx({ status: TransactionStatus.PENDING }));
      accountRepo.findOne.mockResolvedValue(makeAccount());

      await expect(service.reverseTransfer('ref-1', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reverses a completed transfer and fires webhook', async () => {
      const tx = makeTx({ status: TransactionStatus.COMPLETED });
      const reversed = makeTx({ status: TransactionStatus.REVERSED });

      txRepo.findOne
        .mockResolvedValueOnce(tx)          // initial lookup
        .mockResolvedValueOnce(reversed);   // after update

      accountRepo.findOne.mockResolvedValue(makeAccount()); // ownership + ledger entry account

      ledgerRepo.find.mockResolvedValue([
        {
          account_id: 'acc-1',
          amount_kobo: 100_000,
          type: EntryType.DEBIT,
        },
      ]);

      const result = await service.reverseTransfer('ref-1', CLIENT);

      expect(result.status).toBe(TransactionStatus.REVERSED);
      expect(webhooks.deliver).toHaveBeenCalledWith(
        CLIENT,
        WebhookEvent.TRANSFER_REVERSED,
        expect.any(Object),
      );
    });
  });

  // ─── mapAnchorStatus ──────────────────────────────────────────────────────

  describe('mapAnchorStatus', () => {
    it.each([
      ['SUCCESSFUL', TransactionStatus.COMPLETED],
      ['FAILED', TransactionStatus.FAILED],
      ['PENDING', TransactionStatus.PENDING],
      ['PROCESSING', TransactionStatus.PROCESSING],
      ['REVERSED', TransactionStatus.REVERSED],
      ['UNKNOWN', TransactionStatus.PENDING], // default
    ])('maps %s to %s', (anchor, expected) => {
      expect(service.mapAnchorStatus(anchor)).toBe(expected);
    });
  });
});
