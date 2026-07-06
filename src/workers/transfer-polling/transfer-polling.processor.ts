import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import * as Bull from 'bull';
import {
  Transaction,
  TransactionStatus,
  TransactionChannel,
} from '../../database/entities/transaction.entity';
import { LedgerEntry, EntryType } from '../../database/entities/ledger-entry.entity';
import { Account } from '../../database/entities/account.entity';
import { ApiClient } from '../../database/entities/api-client.entity';
import { AnchorService } from '../../providers/anchor/anchor.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/dto/update-webhook.dto';
import { TransfersService } from '../../transfers/transfers.service';

export const TRANSFER_POLLING_QUEUE = 'transfer-polling';
const POLL_JOB_NAME = 'poll-pending-transfers';
const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Polls Anchor every 30 s for all NIBSS transactions still in
 * PENDING or PROCESSING state. When a final status is reached:
 *
 *  • COMPLETED — updates the DB and fires transfer.completed webhook.
 *  • FAILED    — reverses any existing debit ledger entry,
 *                credits the balance back, updates the DB,
 *                and fires transfer.failed webhook.
 *
 * Uses a Bull repeatable job so the interval survives restarts and
 * only one worker instance processes each tick even in a
 * multi-instance deployment.
 */
@Injectable()
@Processor(TRANSFER_POLLING_QUEUE)
export class TransferPollingProcessor implements OnModuleInit {
  private readonly logger = new Logger(TransferPollingProcessor.name);

  constructor(
    @InjectQueue(TRANSFER_POLLING_QUEUE)
    private readonly pollingQueue: Bull.Queue,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(ApiClient)
    private readonly apiClientRepo: Repository<ApiClient>,
    private readonly anchorService: AnchorService,
    private readonly webhooksService: WebhooksService,
    private readonly transfersService: TransfersService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    // Remove stale repeatable jobs from previous runs before adding a fresh one
    const repeatable = await this.pollingQueue.getRepeatableJobs();
    for (const job of repeatable) {
      if (job.name === POLL_JOB_NAME) {
        await this.pollingQueue.removeRepeatableByKey(job.key);
      }
    }

    await this.pollingQueue.add(
      POLL_JOB_NAME,
      {},
      { repeat: { every: POLL_INTERVAL_MS }, jobId: POLL_JOB_NAME },
    );

    this.logger.log(`Transfer polling scheduled every ${POLL_INTERVAL_MS / 1000}s`);
  }

  @Process(POLL_JOB_NAME)
  async pollPendingTransfers(_job: Bull.Job): Promise<void> {
    const pending = await this.transactionRepo.find({
      where: {
        channel: TransactionChannel.NIBSS,
        status: In([TransactionStatus.PENDING, TransactionStatus.PROCESSING]),
      },
    });

    if (!pending.length) return;

    this.logger.log(`Polling ${pending.length} pending NIBSS transaction(s)`);

    await Promise.allSettled(pending.map((tx) => this.reconcileOne(tx)));
  }

  @OnQueueFailed()
  onFailed(_job: Bull.Job, err: Error): void {
    this.logger.error(`Polling job failed: ${err.message}`);
  }

  // ─── Per-transaction reconciliation ───────────────────────────────────────

  private async reconcileOne(transaction: Transaction): Promise<void> {
    if (!transaction.provider_reference) return;

    try {
      const anchorTransfer = await this.anchorService.getTransfer(transaction.provider_reference);
      const newStatus = this.transfersService.mapAnchorStatus(anchorTransfer.attributes.status);

      if (newStatus === transaction.status) return; // no change

      const isFailed = newStatus === TransactionStatus.FAILED;
      const isCompleted = newStatus === TransactionStatus.COMPLETED;

      if (!isFailed && !isCompleted) {
        // Still in flight — just keep the status in sync
        await this.transactionRepo.update(transaction.id, {
          status: newStatus,
          provider_response: anchorTransfer.attributes as unknown as Record<string, any>,
          nibss_session_id: anchorTransfer.attributes.sessionId ?? transaction.nibss_session_id,
        });
        return;
      }

      // Final status — update and possibly reverse ledger
      await this.dataSource.transaction(async (manager) => {
        if (isFailed) {
          // Check if we debited this account already
          const debitEntry = await this.ledgerRepo.findOne({
            where: {
              transaction_id: transaction.id,
              type: EntryType.DEBIT,
            },
          });

          if (debitEntry) {
            // Reverse: credit back the debit account
            const account = await this.accountRepo.findOne({
              where: { id: debitEntry.account_id },
            });

            if (account) {
              const reversalBefore = account.balance_kobo;
              const reversalAfter = reversalBefore + transaction.amount_kobo;

              await manager.save(LedgerEntry, {
                account_id: account.id,
                transaction_id: transaction.id,
                type: EntryType.CREDIT,
                amount_kobo: transaction.amount_kobo,
                balance_before_kobo: reversalBefore,
                balance_after_kobo: reversalAfter,
                narration: `Reversal: failed transfer ${transaction.reference}`,
              });

              await manager.update(Account, account.id, { balance_kobo: reversalAfter });
            }
          }
        }

        await manager.update(Transaction, transaction.id, {
          status: newStatus,
          provider_response: anchorTransfer.attributes as unknown as Record<string, any>,
          nibss_session_id: anchorTransfer.attributes.sessionId ?? transaction.nibss_session_id,
          ...(isFailed && {
            failure_reason: anchorTransfer.attributes.responseMessage,
          }),
        });
      });

      // Load the API client for webhook delivery
      const debitAccount = await this.accountRepo.findOne({
        where: { account_number: transaction.debit_account_number },
      });
      if (!debitAccount) return;

      const apiClient = await this.apiClientRepo.findOne({
        where: { id: debitAccount.api_client_id },
      });
      if (!apiClient) return;

      const refreshed = await this.transactionRepo.findOne({ where: { id: transaction.id } });
      const payload = this.transfersService.toTransferResponse(refreshed!);

      const event = isCompleted
        ? WebhookEvent.TRANSFER_COMPLETED
        : WebhookEvent.TRANSFER_FAILED;

      await this.webhooksService.deliver(apiClient, event, payload);

      this.logger.log(
        `Reconciled transfer ${transaction.reference}: ${transaction.status} → ${newStatus}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to reconcile transfer ${transaction.reference}: ${err.message}`,
      );
    }
  }
}
