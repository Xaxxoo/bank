import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { TransferPollingProcessor, TRANSFER_POLLING_QUEUE } from './transfer-polling.processor';
import { Transaction } from '../../database/entities/transaction.entity';
import { LedgerEntry } from '../../database/entities/ledger-entry.entity';
import { Account } from '../../database/entities/account.entity';
import { ApiClient } from '../../database/entities/api-client.entity';
import { AnchorModule } from '../../providers/anchor/anchor.module';
import { WebhooksModule } from '../../webhooks/webhooks.module';
import { TransfersModule } from '../../transfers/transfers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, LedgerEntry, Account, ApiClient]),
    BullModule.registerQueue({ name: TRANSFER_POLLING_QUEUE }),
    AnchorModule,
    WebhooksModule,
    TransfersModule,
  ],
  providers: [TransferPollingProcessor],
})
export class TransferPollingModule {}
