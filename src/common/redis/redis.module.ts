import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Global module — provides the ioredis client everywhere without re-importing.
 * Used by RateLimitGuard and future caching/queue work.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
