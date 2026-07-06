import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryProcessor } from '../workers/webhook-delivery/webhook-delivery.processor';
import { ApiClient } from '../database/entities/api-client.entity';
import { AuthModule } from '../auth/auth.module';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiClient]),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
    AuthModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
