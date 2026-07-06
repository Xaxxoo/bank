import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VasController } from './vas.controller';
import { VasService } from './vas.service';
import { Transaction } from '../database/entities/transaction.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { Account } from '../database/entities/account.entity';
import { VTPassModule } from '../providers/vtpass/vtpass.module';
import { AuthModule } from '../auth/auth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, LedgerEntry, Account]),
    VTPassModule,
    AuthModule,
    WebhooksModule,
  ],
  controllers: [VasController],
  providers: [VasService],
})
export class VasModule {}
