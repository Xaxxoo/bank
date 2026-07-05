import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ApiClient } from '../database/entities/api-client.entity';
import { Account } from '../database/entities/account.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { Transaction } from '../database/entities/transaction.entity';

export const databaseConfig = (config: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get<string>('DB_HOST', 'localhost'),
  port: config.get<number>('DB_PORT', 5432),
  username: config.get<string>('DB_USERNAME', 'postgres'),
  password: config.get<string>('DB_PASSWORD', 'postgres'),
  database: config.get<string>('DB_NAME', 'pulse_mfb'),
  entities: [ApiClient, Account, LedgerEntry, Transaction],
  synchronize: config.get<string>('NODE_ENV') === 'development',
  logging: config.get<string>('NODE_ENV') === 'development',
});
