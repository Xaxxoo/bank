import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

/**
 * Redis-based fixed-window rate limiter scoped per API client.
 *
 * Default limits (applied when no @RateLimit() decorator is present):
 *   - Read endpoints:  120 requests / 60 seconds
 *   - Write endpoints: 30  requests / 60 seconds
 *
 * The guard reads request.apiClient (set by ApiKeyGuard or HmacGuard before
 * this guard runs) to scope the counter to the authenticated client.
 *
 * Redis key format:
 *   ratelimit:{clientId}:{routeKey}:{windowBucket}
 *
 * Where windowBucket = Math.floor(Date.now() / windowMs) — changes every
 * window, giving us a natural expiry without needing explicit TTL cleanup.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  // Default limits — overridden per-route with @RateLimit()
  private readonly DEFAULT_READ_LIMIT = 120;
  private readonly DEFAULT_WRITE_LIMIT = 30;
  private readonly DEFAULT_WINDOW_SEC = 60;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiClient = request.apiClient;

    // Rate limiting only applies to authenticated clients.
    // If there's no apiClient yet the auth guard hasn't run — skip.
    if (!apiClient?.id) return true;

    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    const method = request.method as string;
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const limit = options?.limit ?? (isWrite ? this.DEFAULT_WRITE_LIMIT : this.DEFAULT_READ_LIMIT);
    const windowSec = options?.windowSec ?? this.DEFAULT_WINDOW_SEC;
    const windowMs = windowSec * 1000;

    // Bucket changes every window, acting as implicit expiry
    const bucket = Math.floor(Date.now() / windowMs);
    const routeKey = `${method}:${request.route?.path ?? 'unknown'}`;
    const redisKey = `ratelimit:${apiClient.id}:${routeKey}:${bucket}`;

    const current = await this.redis.incr(redisKey);

    // Set TTL on first increment — key lives for 2x the window to avoid
    // race conditions around bucket boundaries
    if (current === 1) {
      await this.redis.expire(redisKey, windowSec * 2);
    }

    if (current > limit) {
      this.logger.warn(
        `Rate limit exceeded — client: ${apiClient.id} | route: ${routeKey} | count: ${current}/${limit}`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. Max ${limit} requests per ${windowSec}s. Try again shortly.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Attach rate limit headers so clients can self-throttle
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    response.setHeader('X-RateLimit-Reset', Math.ceil((bucket + 1) * windowMs / 1000));

    return true;
  }
}
