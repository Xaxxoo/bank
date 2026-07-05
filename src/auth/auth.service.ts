import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ApiClient, ApiClientStatus } from '../database/entities/api-client.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(ApiClient)
    private readonly apiClientRepo: Repository<ApiClient>,
    private readonly config: ConfigService,
  ) {}

  // ─── API Client Provisioning ──────────────────────────────────────────────

  async createApiClient(
    businessName: string,
    businessEmail: string,
    permissions: string[] = ['accounts:read', 'transfers:read'],
  ): Promise<{ apiKey: string; publicKey: string; privateKey: string; clientId: string }> {
    const existing = await this.apiClientRepo.findOne({ where: { business_email: businessEmail } });
    if (existing) throw new ConflictException('A client with this email already exists');

    const apiKey = this.generateKey(64);
    const publicKey = this.generateKey(64);
    const privateKey = this.generateKey(64); // returned once, never stored in plaintext

    const client = this.apiClientRepo.create({
      business_name: businessName,
      business_email: businessEmail,
      api_key: apiKey,
      public_key: publicKey,
      private_key_hash: this.hashKey(privateKey),
      permissions,
    });

    await this.apiClientRepo.save(client);

    return { apiKey, publicKey, privateKey, clientId: client.id };
  }

  // ─── API Key Validation ───────────────────────────────────────────────────

  async validateApiKey(apiKey: string): Promise<ApiClient> {
    if (!apiKey) throw new UnauthorizedException('Missing x-api-key header');

    const client = await this.apiClientRepo.findOne({ where: { api_key: apiKey } });

    if (!client) throw new UnauthorizedException('Invalid API key');
    if (client.status !== ApiClientStatus.ACTIVE) {
      throw new UnauthorizedException(`API client is ${client.status}`);
    }

    return client;
  }

  // ─── HMAC Signature Validation ────────────────────────────────────────────

  async validateHmacSignature(
    publicKey: string,
    signature: string,
    timestamp: string,
    rawBody: string,
  ): Promise<ApiClient> {
    if (!publicKey || !signature || !timestamp) {
      throw new UnauthorizedException('Missing HMAC headers: x-public-key, x-signature, x-timestamp');
    }

    // 1. Replay attack prevention — reject requests older than tolerance window
    const toleranceMs = this.config.get<number>('HMAC_TIMESTAMP_TOLERANCE_MS', 300000);
    const requestTime = parseInt(timestamp, 10);
    const now = Date.now();

    if (isNaN(requestTime) || Math.abs(now - requestTime) > toleranceMs) {
      throw new UnauthorizedException('Request timestamp is expired or invalid');
    }

    // 2. Look up client by public key
    const client = await this.apiClientRepo.findOne({ where: { public_key: publicKey } });

    if (!client) throw new UnauthorizedException('Invalid public key');
    if (client.status !== ApiClientStatus.ACTIVE) {
      throw new UnauthorizedException(`API client is ${client.status}`);
    }

    // 3. Recompute expected signature
    // message = timestamp + rawBody (must match client-side signing logic exactly)
    const message = `${timestamp}${rawBody}`;
    const expectedSignature = this.computeHmac(message, client.private_key_hash);

    // 4. Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    const isValid =
      sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);

    if (!isValid) throw new UnauthorizedException('Invalid HMAC signature');

    return client;
  }

  // ─── Permission Check ─────────────────────────────────────────────────────

  hasPermission(client: ApiClient, permission: string): boolean {
    return client.permissions.includes(permission) || client.permissions.includes('*');
  }

  assertPermission(client: ApiClient, permission: string): void {
    if (!this.hasPermission(client, permission)) {
      throw new UnauthorizedException(`Missing required permission: ${permission}`);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private generateKey(length: number): string {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
  }

  private hashKey(key: string): string {
    // SHA-256 hash — we never need to recover the key, only verify the HMAC
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private computeHmac(message: string, keyHash: string): string {
    // We use the stored key hash as the HMAC secret.
    // The client signs with their raw private key, so the server must use
    // the same hash to verify — both sides must agree on this contract.
    return crypto.createHmac('sha256', keyHash).update(message).digest('hex');
  }
}
