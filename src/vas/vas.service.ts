import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  Transaction,
  TransactionStatus,
  TransactionChannel,
} from '../database/entities/transaction.entity';
import { LedgerEntry, EntryType } from '../database/entities/ledger-entry.entity';
import { Account, AccountStatus } from '../database/entities/account.entity';
import { ApiClient } from '../database/entities/api-client.entity';
import { VTPassService } from '../providers/vtpass/vtpass.service';
import { PurchaseAirtimeDto } from './dto/purchase-airtime.dto';
import { PurchaseDataDto } from './dto/purchase-data.dto';
import { ListVasTransactionsDto, VasType } from './dto/list-vas-transactions.dto';
import { DataNetworkOperator } from '../providers/vtpass/vtpass.types';

@Injectable()
export class VasService {
  private readonly logger = new Logger(VasService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly vtpassService: VTPassService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── POST /vas/airtime ────────────────────────────────────────────────────

  async purchaseAirtime(dto: PurchaseAirtimeDto, apiClient: ApiClient) {
    // Idempotency
    const existing = await this.transactionRepo.findOne({ where: { reference: dto.reference } });
    if (existing) return this.toVasResponse(existing);

    const debitAccount = await this.resolveDebitAccount(dto.debit_account_number, apiClient.id);
    const amountKobo = dto.amount * 100;

    this.assertSufficientBalance(debitAccount, amountKobo);

    // Create pending transaction before hitting VTPass
    const transaction = await this.transactionRepo.save(
      this.transactionRepo.create({
        reference: dto.reference,
        debit_account_number: dto.debit_account_number,
        narration: `Airtime - ${dto.operator.toUpperCase()} - ${dto.phone}`,
        amount_kobo: amountKobo,
        status: TransactionStatus.PENDING,
        channel: TransactionChannel.VAS,
      }),
    );

    try {
      const vtpassResult = await this.vtpassService.purchaseAirtime(
        dto.operator,
        dto.phone,
        dto.amount,
        dto.reference,
      );

      await this.settleVasTransaction(transaction.id, debitAccount, amountKobo, {
        status: TransactionStatus.COMPLETED,
        provider_response: vtpassResult as unknown as Record<string, any>,
        provider_reference: vtpassResult.requestId,
      });

      this.logger.log(`Airtime purchase settled: ${dto.reference}`);
    } catch (err) {
      await this.transactionRepo.update(transaction.id, {
        status: TransactionStatus.FAILED,
        failure_reason: err?.message ?? 'VAS provider error',
      });
      throw err;
    }

    const updated = await this.transactionRepo.findOne({ where: { id: transaction.id } });
    return this.toVasResponse(updated!);
  }

  // ─── GET /vas/data/bundles ────────────────────────────────────────────────

  async getDataBundles(operator: DataNetworkOperator) {
    const bundles = await this.vtpassService.getDataBundles(operator);
    return bundles.map((b) => ({
      variation_code: b.variation_code,
      name: b.name,
      amount: parseFloat(b.variation_amount),
      fixed_price: b.fixedPrice === 'Yes',
    }));
  }

  // ─── POST /vas/data ───────────────────────────────────────────────────────

  async purchaseData(dto: PurchaseDataDto, apiClient: ApiClient) {
    const existing = await this.transactionRepo.findOne({ where: { reference: dto.reference } });
    if (existing) return this.toVasResponse(existing);

    const debitAccount = await this.resolveDebitAccount(dto.debit_account_number, apiClient.id);
    const amountKobo = dto.amount * 100;

    this.assertSufficientBalance(debitAccount, amountKobo);

    const transaction = await this.transactionRepo.save(
      this.transactionRepo.create({
        reference: dto.reference,
        debit_account_number: dto.debit_account_number,
        narration: `Data - ${dto.operator.toUpperCase()} - ${dto.variation_code} - ${dto.phone}`,
        amount_kobo: amountKobo,
        status: TransactionStatus.PENDING,
        channel: TransactionChannel.VAS,
      }),
    );

    try {
      const vtpassResult = await this.vtpassService.purchaseData(
        dto.operator,
        dto.phone,
        dto.variation_code,
        dto.amount,
        dto.reference,
      );

      await this.settleVasTransaction(transaction.id, debitAccount, amountKobo, {
        status: TransactionStatus.COMPLETED,
        provider_response: vtpassResult as unknown as Record<string, any>,
        provider_reference: vtpassResult.requestId,
      });

      this.logger.log(`Data purchase settled: ${dto.reference}`);
    } catch (err) {
      await this.transactionRepo.update(transaction.id, {
        status: TransactionStatus.FAILED,
        failure_reason: err?.message ?? 'VAS provider error',
      });
      throw err;
    }

    const updated = await this.transactionRepo.findOne({ where: { id: transaction.id } });
    return this.toVasResponse(updated!);
  }

  // ─── GET /vas/transactions/:reference ────────────────────────────────────

  async getVasTransaction(reference: string, apiClient: ApiClient) {
    const transaction = await this.transactionRepo.findOne({
      where: { reference, channel: TransactionChannel.VAS },
    });

    if (!transaction) throw new NotFoundException('VAS transaction not found');
    await this.assertVasOwnership(transaction, apiClient.id);

    return this.toVasResponse(transaction);
  }

  // ─── GET /vas/transactions ────────────────────────────────────────────────

  async listVasTransactions(dto: ListVasTransactionsDto, apiClient: ApiClient) {
    const clientAccounts = await this.accountRepo.find({
      where: { api_client_id: apiClient.id },
      select: ['account_number'],
    });

    if (!clientAccounts.length) return [];

    const accountNumbers = clientAccounts.map((a) => a.account_number);

    const qb = this.transactionRepo
      .createQueryBuilder('tx')
      .where('tx.debit_account_number IN (:...accountNumbers)', { accountNumbers })
      .andWhere('tx.channel = :channel', { channel: TransactionChannel.VAS })
      .orderBy('tx.created_at', 'DESC')
      .take(dto.limit ?? 20);

    if (dto.type) {
      // Filter by narration prefix since we encode type in narration
      qb.andWhere('tx.narration ILIKE :type', { type: `${dto.type}%` });
    }

    const transactions = await qb.getMany();
    return transactions.map(this.toVasResponse);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async resolveDebitAccount(accountNumber: string, apiClientId: string): Promise<Account> {
    const account = await this.accountRepo.findOne({ where: { account_number: accountNumber } });

    if (!account) throw new NotFoundException('Debit account not found');
    if (account.api_client_id !== apiClientId) {
      throw new ForbiddenException('You do not have access to this account');
    }
    if (account.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${account.status}`);
    }

    return account;
  }

  private assertSufficientBalance(account: Account, amountKobo: number): void {
    if (account.balance_kobo < amountKobo) {
      throw new UnprocessableEntityException('Insufficient balance');
    }
  }

  private async settleVasTransaction(
    transactionId: string,
    debitAccount: Account,
    amountKobo: number,
    update: {
      status: TransactionStatus;
      provider_response: Record<string, any>;
      provider_reference: string;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const balanceBefore = debitAccount.balance_kobo;
      const balanceAfter = balanceBefore - amountKobo;

      await manager.save(LedgerEntry, {
        account_id: debitAccount.id,
        transaction_id: transactionId,
        type: EntryType.DEBIT,
        amount_kobo: amountKobo,
        balance_before_kobo: balanceBefore,
        balance_after_kobo: balanceAfter,
        narration: `VAS debit`,
      });

      await manager.update(Account, debitAccount.id, { balance_kobo: balanceAfter });
      await manager.update(Transaction, transactionId, update);
    });
  }

  private async assertVasOwnership(transaction: Transaction, apiClientId: string): Promise<void> {
    const account = await this.accountRepo.findOne({
      where: {
        account_number: transaction.debit_account_number,
        api_client_id: apiClientId,
      },
    });
    if (!account) throw new ForbiddenException('You do not have access to this transaction');
  }

  private toVasResponse(tx: Transaction) {
    return {
      reference: tx.reference,
      debit_account_number: tx.debit_account_number,
      amount: tx.amount_kobo / 100,
      narration: tx.narration,
      status: tx.status,
      channel: tx.channel,
      provider_reference: tx.provider_reference ?? undefined,
      failure_reason: tx.failure_reason ?? undefined,
      created_at: tx.created_at,
    };
  }
}
