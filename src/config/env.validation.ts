import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  // ── App ───────────────────────────────────────────────────────────────────

  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(65535)
  PORT: number;

  // ── Database ──────────────────────────────────────────────────────────────

  @IsString()
  DB_HOST: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  // ── Redis ─────────────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  REDIS_HOST: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number;

  // ── HMAC ──────────────────────────────────────────────────────────────────

  @IsNumber()
  @IsOptional()
  @Min(1_000)
  HMAC_TIMESTAMP_TOLERANCE_MS: number;

  // ── Anchor (BaaS provider) ────────────────────────────────────────────────

  @IsString()
  ANCHOR_API_KEY: string;

  @IsString()
  @IsOptional()
  ANCHOR_BASE_URL: string;

  // ── VTPass (VAS provider) ─────────────────────────────────────────────────

  @IsString()
  VTPASS_USERNAME: string;

  @IsString()
  VTPASS_PASSWORD: string;

  @IsString()
  VTPASS_API_KEY: string;

  @IsString()
  @IsOptional()
  VTPASS_BASE_URL: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed — ${messages}`);
  }

  return validated;
}
