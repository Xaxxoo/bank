import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { HmacGuard } from './guards/hmac.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { ApiClient } from '../database/entities/api-client.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiClient])],
  providers: [AuthService, ApiKeyGuard, HmacGuard, RateLimitGuard],
  exports: [AuthService, ApiKeyGuard, HmacGuard, RateLimitGuard],
})
export class AuthModule {}
