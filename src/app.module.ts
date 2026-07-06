import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransfersModule } from './transfers/transfers.module';
import { VasModule } from './vas/vas.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RedisModule } from './common/redis/redis.module';
import { ApiClientController } from './api-client/api-client.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => databaseConfig(config),
    }),
    RedisModule,
    AuthModule,
    AccountsModule,
    TransfersModule,
    VasModule,
    WebhooksModule,
  ],
  controllers: [ApiClientController],
})
export class AppModule {}
