import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
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
import { AnchorService } from '../providers/anchor/anchor.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { NameEnquiryDto } from './dto/name-enquiry.dto';
import { ListTransfersDto } from './dto/list-transfers.dto';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly anchorService: AnchorService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── POST /transfers/name-enquiry ─────────────────────────────────────────

  async nameEnquiry(dto: NameEnquiryDto) {
    const result = await this.anchorService.nameEnquiry(dto.accountNumber, dto.bankCode);

    return {
      accountNumber: result.accountNumber,
      accountName: result.accountName,
      bankCode: result.bankCode,
      responseCode: result.responseCode,
      responseMessage: result.responseMessage,
    };
  }

  // ─── POST /transfers ──────────────────────────────────────────────────────

  async initiateTransfer(dto: CreateTransferDto, apiClient: ApiClient) {
    // 1. Idempotency — same reference returns existing transaction
    const existing = await this.transactionRepo.findOne({
      where: { reference: dto.reference },
    });
    if (existing) {
      this.logger.log(`Idempotent transfer hit for reference: ${dto.reference}`);
      return this.toTransferResponse(existing);
    }

    // 2. Validate debit account belongs to this API client
    const debitAccount = await this.accountRepo.findOne({
      where: { account_number: dto.debit_account_number },
    });

    if (!debitAccount) throw new NotFoundException('Debit account not found');
    if (debitAccount.api_client_id !== apiClient.id) {
      throw new ForbiddenException('You do not have access to this account');
    }
    if (debitAccount.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Debit account is ${debitAccount.status}`);
    }

    // 3. Check balance (amount in Naira → convert to kobo)
    const amountKobo = dto.amount * 100;
    if (debitAccount.balance_kobo < amountKobo) {
      throw new UnprocessableEntityException('Insufficient balance');
    }

    // 4. Route: internal (beneficiary in our DB) vs external (NIBSS via Anchor)
    const creditAccount = await this.accountRepo.findOne({
      where: { account_number: dto.beneficiary_account_number },
    });

    if (creditAccount) {
      return this.executeInternalTransfer(dto, debitAccount, creditAccount, amountKobo);
    }

    return this.executeNibssTransfer(dto, debitAccount, amountKobo);
  }

  // ─── Internal transfer (both accounts are in our DB) ──────────────────────

  private async executeInternalTransfer(
    dto: CreateTransferDto,
    debitAccount: Account,
    creditAccount: Account,
    amountKobo: number,
  ) {
    if (creditAccount.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Beneficiary account is ${creditAccount.status}`);
    }

    if (debitAccount.account_number === creditAccount.account_number) {
      throw new BadRequestException('Cannot transfer to the same account');
    }

    // Create the transaction record and settle it atomically in one DB transaction
    const transaction = await this.transactionRepo.save(
      this.transactionRepo.create({
        reference: dto.reference,
        debit_account_number: dto.debit_account_number,
        credit_account_number: dto.beneficiary_account_number,
        amount_kobo: amountKobo,
        narration: dto.narration,
        status: TransactionStatus.PENDING,
        channel: TransactionChannel.INTERNAL,
      }),
    );

    await this.dataSource.transaction(async (manager) => {
      const debitBefore = debitAccount.balance_kobo;
      const debitAfter = debitBefore - amountKobo;
      const creditBefore = creditAccount.balance_kobo;
      const creditAfter = creditBefore + amountKobo;

      // Debit leg
      await manager.save(LedgerEntry, {
        account_id: debitAccount.id,
        transaction_id: transaction.id,
        type: EntryType.DEBIT,
        amount_kobo: amountKobo,
        balance_before_kobo: debitBefore,
        balance_after_kobo: debitAfter,
        narration: dto.narration,
      });
      await manager.update(Account, debitAccount.id, { balance_kobo: debitAfter });

      // Credit leg
      await manager.save(LedgerEntry, {
        account_id: creditAccount.id,
        transaction_id: transaction.id,
        type: EntryType.CREDIT,
        amount_kobo: amountKobo,
        balance_before_kobo: creditBefore,
        balance_after_kobo: creditAfter,
        narration: dto.narration,
      });
      await manager.update(Account, creditAccount.id, { balance_kobo: creditAfter });

      await manager.update(Transaction, transaction.id, {
        status: TransactionStatus.COMPLETED,
      });
    });

    const settled = await this.transactionRepo.findOne({ where: { id: transaction.id } });
    this.logger.log(`Internal transfer ${dto.reference} settled instantly`);
    return this.toTransferResponse(settled!);
  }

  // ─── External transfer (NIBSS via Anchor) ─────────────────────────────────

  private async executeNibssTransfer(
    dto: CreateTransferDto,
    debitAccount: Account,
    amountKobo: number,
  ) {
    if (!dto.beneficiary_bank_code) {
      throw new BadRequestException(
        'beneficiary_bank_code is required for transfers to external banks',
      );
    }

    // Create pending transaction record before calling Anchor —
    // gives us an audit trail even if the provider call fails
    const transaction = await this.transactionRepo.save(
      this.transactionRepo.create({
        reference: dto.reference,
        debit_account_number: dto.debit_account_number,
        credit_account_number: dto.beneficiary_account_number,
        beneficiary_bank_code: dto.beneficiary_bank_code,
        amount_kobo: amountKobo,
        narration: dto.narration,
        status: TransactionStatus.PENDING,
        channel: TransactionChannel.NIBSS,
      }),
    );

    try {
      // Call Anchor → NIBSS NIP
      const anchorTransfer = await this.anchorService.initiateTransfer(
        debitAccount.provider_account_id,
        dto.beneficiary_account_number,
        dto.beneficiary_bank_code,
        amountKobo,
        dto.narration,
        dto.reference,
      );

      const anchorStatus = anchorTransfer.attributes.status;
      const newStatus = this.mapAnchorStatus(anchorStatus);

      // Atomically debit ledger + update transaction status
      await this.dataSource.transaction(async (manager) => {
        if (newStatus !== TransactionStatus.FAILED) {
          const balanceBefore = debitAccount.balance_kobo;
          const balanceAfter = balanceBefore - amountKobo;

          await manager.save(LedgerEntry, {
            account_id: debitAccount.id,
            transaction_id: transaction.id,
            type: EntryType.DEBIT,
            amount_kobo: amountKobo,
            balance_before_kobo: balanceBefore,
            balance_after_kobo: balanceAfter,
            narration: dto.narration,
          });

          await manager.update(Account, debitAccount.id, { balance_kobo: balanceAfter });
        }

        await manager.update(Transaction, transaction.id, {
          status: newStatus,
          nibss_session_id: anchorTransfer.attributes.sessionId,
          provider_reference: anchorTransfer.id,
          provider_response: anchorTransfer.attributes as unknown as Record<string, any>,
          ...(newStatus === TransactionStatus.FAILED && {
            failure_reason: anchorTransfer.attributes.responseMessage,
          }),
        });
      });

      const updated = await this.transactionRepo.findOne({ where: { id: transaction.id } });
      this.logger.log(
        `NIBSS transfer ${dto.reference} → status: ${updated!.status} | sessionId: ${anchorTransfer.attributes.sessionId}`,
      );
      return this.toTransferResponse(updated!);

    } catch (err) {
      if (transaction?.id) {
        await this.transactionRepo.update(transaction.id, {
          status: TransactionStatus.FAILED,
          failure_reason: err?.message ?? 'Provider error',
        });
      }
      throw err;
    }
  }

  // ─── GET /transfers/:reference ────────────────────────────────────────────

  async getTransfer(reference: string, apiClient: ApiClient) {
    const transaction = await this.transactionRepo.findOne({ where: { reference } });

    if (!transaction) throw new NotFoundException('Transfer not found');

    // Verify the debit account belongs to this client
    await this.assertTransactionOwnership(transaction, apiClient.id);

    // If still processing, check live status from Anchor and sync
    if (
      transaction.status === TransactionStatus.PROCESSING ||
      transaction.status === TransactionStatus.PENDING
    ) {
      await this.syncTransactionStatus(transaction);
    }

    const refreshed = await this.transactionRepo.findOne({ where: { reference } });
    return this.toTransferResponse(refreshed!);
  }

  // ─── GET /transfers ───────────────────────────────────────────────────────

  async listTransfers(dto: ListTransfersDto, apiClient: ApiClient) {
    // Get all account numbers that belong to this client
    const clientAccounts = await this.accountRepo.find({
      where: { api_client_id: apiClient.id },
      select: ['account_number'],
    });

    if (!clientAccounts.length) return [];

    const accountNumbers = clientAccounts.map((a) => a.account_number);

    const qb = this.transactionRepo
      .createQueryBuilder('tx')
      .where('tx.debit_account_number IN (:...accountNumbers)', { accountNumbers })
      .orderBy('tx.created_at', 'DESC')
      .take(dto.limit ?? 20);

    if (dto.status) {
      qb.andWhere('tx.status = :status', { status: dto.status });
    }

    const transactions = await qb.getMany();
    return transactions.map(this.toTransferResponse);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async assertTransactionOwnership(
    transaction: Transaction,
    apiClientId: string,
  ): Promise<void> {
    const account = await this.accountRepo.findOne({
      where: {
        account_number: transaction.debit_account_number,
        api_client_id: apiClientId,
      },
    });
    if (!account) throw new ForbiddenException('You do not have access to this transfer');
  }

  private async syncTransactionStatus(transaction: Transaction): Promise<void> {
    if (!transaction.provider_reference) return;

    try {
      const anchorTransfer = await this.anchorService.getTransfer(transaction.provider_reference);
      const newStatus = this.mapAnchorStatus(anchorTransfer.attributes.status);

      if (newStatus !== transaction.status) {
        await this.transactionRepo.update(transaction.id, {
          status: newStatus,
          provider_response: anchorTransfer.attributes as unknown as Record<string, any>,
          nibss_session_id: anchorTransfer.attributes.sessionId ?? transaction.nibss_session_id,
          ...(newStatus === TransactionStatus.FAILED && {
            failure_reason: anchorTransfer.attributes.responseMessage,
          }),
        });
      }
    } catch (err) {
      // Non-fatal — we tried to sync, log and move on
      this.logger.warn(`Could not sync transfer status for ${transaction.reference}: ${err.message}`);
    }
  }

  private mapAnchorStatus(anchorStatus: string): TransactionStatus {
    const map: Record<string, TransactionStatus> = {
      PENDING: TransactionStatus.PENDING,
      PROCESSING: TransactionStatus.PROCESSING,
      SUCCESSFUL: TransactionStatus.COMPLETED,
      FAILED: TransactionStatus.FAILED,
      REVERSED: TransactionStatus.REVERSED,
    };
    return map[anchorStatus] ?? TransactionStatus.PENDING;
  }

  private toTransferResponse(tx: Transaction) {
    return {
      reference: tx.reference,
      debit_account_number: tx.debit_account_number,
      beneficiary_account_number: tx.credit_account_number,
      beneficiary_bank_code: tx.beneficiary_bank_code,
      amount: tx.amount_kobo / 100,        // return in Naira
      amount_kobo: tx.amount_kobo,
      narration: tx.narration,
      status: tx.status,
      nibss_session_id: tx.nibss_session_id,
      channel: tx.channel,
      failure_reason: tx.failure_reason ?? undefined,
      created_at: tx.created_at,
      updated_at: tx.updated_at,
    };
  }
}
