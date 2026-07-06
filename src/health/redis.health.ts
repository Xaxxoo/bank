import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';

/**
 * Custom health indicator for the ioredis client.
 * Sends a PING and expects PONG within the connection timeout.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const result = await this.redis.ping();
      const up = result === 'PONG';
      if (!up) throw new Error(`Unexpected PING response: ${result}`);
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: err.message }),
      );
    }
  }
}
