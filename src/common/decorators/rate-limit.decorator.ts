import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** Max requests allowed within the window */
  limit: number;
  /** Window duration in seconds */
  windowSec: number;
}

/**
 * Override the default rate limit on a specific route.
 *
 * @example
 * // Allow 10 requests per minute (tighter limit for writes)
 * @RateLimit({ limit: 10, windowSec: 60 })
 * @Post('prefix')
 *
 * @example
 * // Allow 5 per minute for sensitive operations
 * @RateLimit({ limit: 5, windowSec: 60 })
 * @Post()
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
