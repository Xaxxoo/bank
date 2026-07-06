import { SetMetadata, createParamDecorator, ExecutionContext, applyDecorators, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { HmacGuard } from '../guards/hmac.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ApiClient } from '../../database/entities/api-client.entity';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Use on routes that require only an API key (read operations).
 *
 * @example
 * @UseApiKey('accounts:read')
 * @Get(':account_number/balance')
 */
export const UseApiKey = (...permissions: string[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(ApiKeyGuard, RateLimitGuard),
  );

/**
 * Use on routes that require HMAC signature (write operations).
 *
 * @example
 * @UseHmac('accounts:write')
 * @Post('prefix')
 */
export const UseHmac = (...permissions: string[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(HmacGuard, RateLimitGuard),
  );

/**
 * Injects the resolved ApiClient from the request into a controller parameter.
 *
 * @example
 * async createAccount(@ApiClientContext() client: ApiClient) { ... }
 */
export const ApiClientContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiClient => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiClient;
  },
);

/**
 * Declare required permissions on a route without applying a guard.
 * Use when the guard is applied at the controller level.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
