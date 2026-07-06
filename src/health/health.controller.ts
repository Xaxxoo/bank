import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

/**
 * GET /api/v1/health
 *
 * Returns the liveness status of each critical dependency:
 *   - database  → TypeORM ping against PostgreSQL
 *   - redis     → ioredis PING/PONG
 *
 * Responds 200 when all checks pass, 503 when any check fails.
 * No authentication required — used by load balancers and uptime monitors.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }
}
