import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { HmacGuard } from './guards/hmac.guard';
import { ApiClient } from '../database/entities/api-client.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiClient])],
  providers: [AuthService, ApiKeyGuard, HmacGuard],
  exports: [AuthService, ApiKeyGuard, HmacGuard],
})
export class AuthModule {}
