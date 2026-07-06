import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load .env before anything else — this file is used by the TypeORM CLI
// independently of the NestJS app bootstrap process.
config();

import { ApiClient } from './entities/api-client.entity';
import { Account } from './entities/account.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Transaction } from './entities/transaction.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'pulse_mfb',
  entities: [ApiClient, Account, LedgerEntry, Transaction],
  migrations: ['src/database/migrations/*.ts'],
  // Never synchronize in CLI context — migrations are the source of truth
  synchronize: false,
});
