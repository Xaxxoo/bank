import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountType, AccountStatus } from '../database/entities/account.entity';
import { ApiClient } from '../database/entities/api-client.entity';
import { AnchorService } from '../providers/anchor/anchor.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly anchorService: AnchorService,
  ) {}

  // ─── POST /accounts/prefix ────────────────────────────────────────────────

  async createPrefixAccount(
    dto: CreateAccountDto,
    apiClient: ApiClient,
  ): Promise<AccountDetail> {
    // 1. Idempotency — same reference from same client returns the existing account
    const existing = await this.accountRepo.findOne({
      where: { reference: dto.reference, api_client_id: apiClient.id },
    });
    if (existing) {
      this.logger.log(`Idempotent account creation hit for reference: ${dto.reference}`);
      return this.toDetailResponse(existing);
    }

    // 2. Prevent duplicate email/BVN per API client
    const duplicateBvn = await this.accountRepo.findOne({
      where: { bvn: dto.bvn, api_client_id: apiClient.id },
    });
    if (duplicateBvn) {
      throw new ConflictException('An account with this BVN already exists for your business');
    }

    // 3. Create customer on Anchor
    const anchorCustomer = await this.anchorService.createCustomer(
      dto.customer_name,
      dto.customer_email,
      dto.customer_phone,
      dto.bvn,
    );

    // 4. Create virtual deposit account on Anchor → get NUBAN
    const anchorAccount = await this.anchorService.createDepositAccount(anchorCustomer.id);

    // 5. Persist to our DB
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

    return this.toDetailResponse(account);
  }

  // ─── GET /accounts/:account_number/balance ────────────────────────────────

  async getBalance(
    accountNumber: string,
    apiClient: ApiClient,
  ): Promise<BalanceResponse> {
    const account = await this.findAndVerifyOwnership(accountNumber, apiClient.id);

    // Fetch live balance from Anchor as the source of truth
    const anchorAccount = await this.anchorService.getDepositAccount(
      account.provider_account_id,
    );

    const balanceKobo = anchorAccount.attributes.balance;

    // Keep our local balance in sync
    if (account.balance_kobo !== balanceKobo) {
      await this.accountRepo.update(account.id, { balance_kobo: balanceKobo });
    }

    return {
      account_number: accountNumber,
      account_name: account.customer_name,
      balance: balanceKobo / 100,           // in Naira
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

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async findAndVerifyOwnership(
    accountNumber: string,
    apiClientId: string,
  ): Promise<Account> {
    const account = await this.accountRepo.findOne({
      where: { account_number: accountNumber },
    });

    if (!account) throw new NotFoundException('Account not found');

    // Prevent cross-client data access
    if (account.api_client_id !== apiClientId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    if (account.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${account.status}`);
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
