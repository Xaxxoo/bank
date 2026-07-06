import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { databaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransfersModule } from './transfers/transfers.module';
import { VasModule } from './vas/vas.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RedisModule } from './common/redis/redis.module';
import { TransferPollingModule } from './workers/transfer-polling/transfer-polling.module';
import { HealthModule } from './health/health.module';
import { ApiClientController } from './api-client/api-client.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => databaseConfig(config),
    }),
    // Bull uses the same Redis instance as the rate limiter
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    RedisModule,
    AuthModule,
    AccountsModule,
    TransfersModule,
    VasModule,
    WebhooksModule,
    TransferPollingModule,
    HealthModule,
  ],
  controllers: [ApiClientController],
})
export class AppModule {}
