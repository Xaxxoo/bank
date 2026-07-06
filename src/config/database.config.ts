import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ApiClient } from '../database/entities/api-client.entity';
import { Account } from '../database/entities/account.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { Transaction } from '../database/entities/transaction.entity';

export const databaseConfig = (config: ConfigService): TypeOrmModuleOptions => {
  const isDev = config.get<string>('NODE_ENV') === 'development';

  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 5432),
    username: config.get<string>('DB_USERNAME', 'postgres'),
    password: config.get<string>('DB_PASSWORD', ''),
    database: config.get<string>('DB_NAME', 'pulse_mfb'),
    entities: [ApiClient, Account, LedgerEntry, Transaction],
    migrations: ['dist/database/migrations/*.js'],
    // synchronize only in development — never in staging or production.
    // In all other environments, migrations must be run explicitly via:
    //   npm run migration:run
    synchronize: isDev,
    migrationsRun: !isDev,
    logging: isDev,
  };
};
