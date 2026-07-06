import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountsService } from './accounts.service';
import { Account, AccountStatus, AccountType } from '../database/entities/account.entity';
import { AnchorService } from '../providers/anchor/anchor.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ApiClient } from '../database/entities/api-client.entity';
import { WebhookEvent } from '../webhooks/dto/update-webhook.dto';

const mockRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const mockAnchor = () => ({
  createCustomer: jest.fn(),
  createDepositAccount: jest.fn(),
  getDepositAccount: jest.fn(),
});

const mockWebhooks = () => ({ deliver: jest.fn() });

const CLIENT: ApiClient = { id: 'client-1', webhook_url: null, webhook_events: [] } as any;

const makeAccount = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  account_number: '0123456789',
  account_type: AccountType.PREFIX,
  customer_name: 'Amina Bello',
  customer_email: 'amina@test.com',
  customer_phone: '08012345678',
  bvn: '12345678901',
  balance_kobo: 100_000,
  status: AccountStatus.ACTIVE,
  reference: 'ref-1',
  api_client_id: CLIENT.id,
  provider_account_id: 'anchor-acc-1',
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
} as Account);

describe('AccountsService', () => {
  let service: AccountsService;
  let repo: ReturnType<typeof mockRepo>;
  let anchor: ReturnType<typeof mockAnchor>;
  let webhooks: ReturnType<typeof mockWebhooks>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getRepositoryToken(Account), useFactory: mockRepo },
        { provide: AnchorService, useFactory: mockAnchor },
        { provide: WebhooksService, useFactory: mockWebhooks },
      ],
    }).compile();

    service = module.get(AccountsService);
    repo = module.get(getRepositoryToken(Account));
    anchor = module.get(AnchorService);
    webhooks = module.get(WebhooksService);
  });

  // ─── createPrefixAccount ──────────────────────────────────────────────────

  describe('createPrefixAccount', () => {
    const dto = {
      customer_name: 'Amina Bello',
      customer_phone: '08012345678',
      customer_email: 'amina@test.com',
      bvn: '12345678901',
      reference: 'ref-1',
    };

    it('returns existing account on duplicate reference (idempotency)', async () => {
      const existing = makeAccount();
      repo.findOne.mockResolvedValueOnce(existing);

      const result = await service.createPrefixAccount(dto, CLIENT);
      expect(result.account_number).toBe(existing.account_number);
      expect(anchor.createCustomer).not.toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate BVN', async () => {
      repo.findOne
        .mockResolvedValueOnce(null)         // reference check → not found
        .mockResolvedValueOnce(makeAccount()); // BVN check → exists

      await expect(service.createPrefixAccount(dto, CLIENT)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('creates account and fires account.created webhook', async () => {
      repo.findOne.mockResolvedValue(null);
      anchor.createCustomer.mockResolvedValue({ id: 'cust-1' });
      anchor.createDepositAccount.mockResolvedValue({
        id: 'anchor-acc-1',
        attributes: { accountNumber: '0123456789' },
      });
      repo.create.mockImplementation((d) => d);
      repo.save.mockImplementation((a) => ({ ...a, created_at: new Date(), updated_at: new Date() }));

      const result = await service.createPrefixAccount(dto, CLIENT);

      expect(result.account_number).toBe('0123456789');
      expect(webhooks.deliver).toHaveBeenCalledWith(CLIENT, WebhookEvent.ACCOUNT_CREATED, expect.any(Object));
    });
  });

  // ─── freeze / unfreeze / close ────────────────────────────────────────────

  describe('freezeAccount', () => {
    it('throws NotFoundException if account does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.freezeAccount('0000000000', CLIENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException if account belongs to another client', async () => {
      repo.findOne.mockResolvedValue(makeAccount({ api_client_id: 'other-client' }));
      await expect(service.freezeAccount('0123456789', CLIENT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws BadRequestException if account is already frozen', async () => {
      repo.findOne.mockResolvedValue(makeAccount({ status: AccountStatus.FROZEN }));
      await expect(service.freezeAccount('0123456789', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException if account is closed', async () => {
      repo.findOne.mockResolvedValue(makeAccount({ status: AccountStatus.CLOSED }));
      await expect(service.freezeAccount('0123456789', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('freezes an active account', async () => {
      const frozen = makeAccount({ status: AccountStatus.FROZEN });
      repo.findOne
        .mockResolvedValueOnce(makeAccount())   // first call (findAndVerifyOwnershipAnyStatus)
        .mockResolvedValueOnce(frozen);          // second call (after update)
      repo.update.mockResolvedValue(undefined);

      const result = await service.freezeAccount('0123456789', CLIENT);
      expect(result.status).toBe(AccountStatus.FROZEN);
      expect(repo.update).toHaveBeenCalledWith('acc-1', { status: AccountStatus.FROZEN });
    });
  });

  describe('unfreezeAccount', () => {
    it('throws BadRequestException if account is already active', async () => {
      repo.findOne.mockResolvedValue(makeAccount({ status: AccountStatus.ACTIVE }));
      await expect(service.unfreezeAccount('0123456789', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('unfreezes a frozen account', async () => {
      const active = makeAccount({ status: AccountStatus.ACTIVE });
      repo.findOne
        .mockResolvedValueOnce(makeAccount({ status: AccountStatus.FROZEN }))
        .mockResolvedValueOnce(active);
      repo.update.mockResolvedValue(undefined);

      const result = await service.unfreezeAccount('0123456789', CLIENT);
      expect(result.status).toBe(AccountStatus.ACTIVE);
    });
  });

  describe('closeAccount', () => {
    it('throws BadRequestException if account is already closed', async () => {
      repo.findOne.mockResolvedValue(makeAccount({ status: AccountStatus.CLOSED }));
      await expect(service.closeAccount('0123456789', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('closes an active account', async () => {
      const closed = makeAccount({ status: AccountStatus.CLOSED });
      repo.findOne
        .mockResolvedValueOnce(makeAccount())
        .mockResolvedValueOnce(closed);
      repo.update.mockResolvedValue(undefined);

      const result = await service.closeAccount('0123456789', CLIENT);
      expect(result.status).toBe(AccountStatus.CLOSED);
    });
  });
});
