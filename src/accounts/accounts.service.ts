import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountType, AccountStatus } from '../database/entities/account.entity';
import { ApiClient } from '../database/entities/api-client.entity';
import { AnchorService } from '../providers/anchor/anchor.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/dto/update-webhook.dto';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly anchorService: AnchorService,
    private readonly webhooksService: WebhooksService,
  ) {}

  // ─── POST /accounts/prefix ────────────────────────────────────────────────

  async createPrefixAccount(
    dto: CreateAccountDto,
    apiClient: ApiClient,
  ): Promise<AccountDetail> {
    const existing = await this.accountRepo.findOne({
      where: { reference: dto.reference, api_client_id: apiClient.id },
    });
    if (existing) {
      this.logger.log(`Idempotent account creation hit for reference: ${dto.reference}`);
      return this.toDetailResponse(existing);
    }

    const duplicateBvn = await this.accountRepo.findOne({
      where: { bvn: dto.bvn, api_client_id: apiClient.id },
    });
    if (duplicateBvn) {
      throw new ConflictException('An account with this BVN already exists for your business');
    }

    const anchorCustomer = await this.anchorService.createCustomer(
      dto.customer_name,
      dto.customer_email,
      dto.customer_phone,
      dto.bvn,
    );

    const anchorAccount = await this.anchorService.createDepositAccount(anchorCustomer.id);

    const account = this.accountRepo.create({
      account_number: anchorAccount.attributes.accountNumber,
      account_type: AccountType.PREFIX,
      customer_name: dto.customer_name,
      customer_phone: dto.customer_phone,
      customer_email: dto.customer_email,
      bvn: dto.bvn,
      balance_kobo: 0,
      reference: dto.reference,
      api_client_id: apiClient.id,
      provider_account_id: anchorAccount.id,
    });

    await this.accountRepo.save(account);
    this.logger.log(`Account created: ${account.account_number} for client ${apiClient.id}`);

    const response = this.toDetailResponse(account);
    await this.webhooksService.deliver(apiClient, WebhookEvent.ACCOUNT_CREATED, response);

    return response;
  }

  // ─── GET /accounts/:account_number/balance ────────────────────────────────

  async getBalance(
    accountNumber: string,
    apiClient: ApiClient,
  ): Promise<BalanceResponse> {
    const account = await this.findAndVerifyOwnership(accountNumber, apiClient.id);

    const anchorAccount = await this.anchorService.getDepositAccount(
      account.provider_account_id,
    );

    const balanceKobo = anchorAccount.attributes.balance;

    if (account.balance_kobo !== balanceKobo) {
      await this.accountRepo.update(account.id, { balance_kobo: balanceKobo });
    }

    return {
      account_number: accountNumber,
      account_name: account.customer_name,
      balance: balanceKobo / 100,
      balance_kobo: balanceKobo,
      currency: 'NGN',
    };
  }

  // ─── GET /accounts/:account_number ───────────────────────────────────────

  async getAccount(
    accountNumber: string,
    apiClient: ApiClient,
  ): Promise<AccountDetail> {
    const account = await this.findAndVerifyOwnership(accountNumber, apiClient.id);
    return this.toDetailResponse(account);
  }

  // ─── PATCH /accounts/:account_number/freeze ───────────────────────────────

  async freezeAccount(accountNumber: string, apiClient: ApiClient): Promise<AccountDetail> {
    const account = await this.findAndVerifyOwnershipAnyStatus(accountNumber, apiClient.id);

    if (account.status === AccountStatus.FROZEN) {
      throw new BadRequestException('Account is already frozen');
    }
    if (account.status === AccountStatus.CLOSED) {
      throw new BadRequestException('Cannot freeze a closed account');
    }

    await this.accountRepo.update(account.id, { status: AccountStatus.FROZEN });
    const updated = await this.accountRepo.findOne({ where: { id: account.id } });
    this.logger.log(`Account frozen: ${accountNumber} by client ${apiClient.id}`);
    return this.toDetailResponse(updated!);
  }

  // ─── PATCH /accounts/:account_number/unfreeze ─────────────────────────────

  async unfreezeAccount(accountNumber: string, apiClient: ApiClient): Promise<AccountDetail> {
    const account = await this.findAndVerifyOwnershipAnyStatus(accountNumber, apiClient.id);

    if (account.status === AccountStatus.ACTIVE) {
      throw new BadRequestException('Account is already active');
    }
    if (account.status === AccountStatus.CLOSED) {
      throw new BadRequestException('Cannot unfreeze a closed account');
    }

    await this.accountRepo.update(account.id, { status: AccountStatus.ACTIVE });
    const updated = await this.accountRepo.findOne({ where: { id: account.id } });
    this.logger.log(`Account unfrozen: ${accountNumber} by client ${apiClient.id}`);
    return this.toDetailResponse(updated!);
  }

  // ─── PATCH /accounts/:account_number/close ────────────────────────────────

  async closeAccount(accountNumber: string, apiClient: ApiClient): Promise<AccountDetail> {
    const account = await this.findAndVerifyOwnershipAnyStatus(accountNumber, apiClient.id);

    if (account.status === AccountStatus.CLOSED) {
      throw new BadRequestException('Account is already closed');
    }

    await this.accountRepo.update(account.id, { status: AccountStatus.CLOSED });
    const updated = await this.accountRepo.findOne({ where: { id: account.id } });
    this.logger.log(`Account closed: ${accountNumber} by client ${apiClient.id}`);
    return this.toDetailResponse(updated!);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Finds an account and verifies ownership. Throws if the account is not ACTIVE.
   * Used for operations that require an active account (balance, transfers, VAS).
   */
  private async findAndVerifyOwnership(
    accountNumber: string,
    apiClientId: string,
  ): Promise<Account> {
    const account = await this.accountRepo.findOne({
      where: { account_number: accountNumber },
    });

    if (!account) throw new NotFoundException('Account not found');

    if (account.api_client_id !== apiClientId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    if (account.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${account.status}`);
    }

    return account;
  }

  /**
   * Finds an account and verifies ownership regardless of status.
   * Used for freeze/unfreeze/close operations.
   */
  private async findAndVerifyOwnershipAnyStatus(
    accountNumber: string,
    apiClientId: string,
  ): Promise<Account> {
    const account = await this.accountRepo.findOne({
      where: { account_number: accountNumber },
    });

    if (!account) throw new NotFoundException('Account not found');

    if (account.api_client_id !== apiClientId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    return account;
  }

  private toDetailResponse(account: Account): AccountDetail {
    return {
      account_number: account.account_number,
      account_name: account.customer_name,
      account_type: account.account_type,
      customer_email: account.customer_email,
      customer_phone: account.customer_phone,
      status: account.status,
      reference: account.reference,
      created_at: account.created_at,
    };
  }
}

// ─── Response Shape Interfaces ────────────────────────────────────────────────

export interface AccountDetail {
  account_number: string;
  account_name: string;
  account_type: AccountType;
  customer_email: string;
  customer_phone: string;
  status: AccountStatus;
  reference: string;
  created_at: Date;
}

export interface BalanceResponse {
  account_number: string;
  account_name: string;
  balance: number;
  balance_kobo: number;
  currency: string;
}
