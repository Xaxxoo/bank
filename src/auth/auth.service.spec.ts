import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { ApiClient, ApiClientStatus } from '../database/entities/api-client.entity';

const mockRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockConfig = () => ({
  get: jest.fn((key: string, def?: any) => {
    if (key === 'HMAC_TIMESTAMP_TOLERANCE_MS') return 300_000;
    return def;
  }),
});

describe('AuthService', () => {
  let service: AuthService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(ApiClient), useFactory: mockRepo },
        { provide: ConfigService, useFactory: mockConfig },
      ],
    }).compile();

    service = module.get(AuthService);
    repo = module.get(getRepositoryToken(ApiClient));
  });

  // ─── createApiClient ───────────────────────────────────────────────────────

  describe('createApiClient', () => {
    it('throws ConflictException when email already exists', async () => {
      repo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.createApiClient('Acme', 'ops@acme.com'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a client and returns keys', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockImplementation((dto) => dto);
      // TypeORM save() mutates the entity and sets the generated id
      repo.save.mockImplementation((entity) => { entity.id = 'new-id'; return entity; });

      const result = await service.createApiClient('Acme', 'ops@acme.com', ['accounts:read']);

      expect(result).toMatchObject({
        apiKey: expect.any(String),
        publicKey: expect.any(String),
        privateKey: expect.any(String),
        clientId: 'new-id',
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('never stores the private key in plaintext', async () => {
      repo.findOne.mockResolvedValue(null);
      let savedClient: any;
      repo.create.mockImplementation((dto) => dto);
      repo.save.mockImplementation((client) => {
        savedClient = client;
        client.id = 'x';
        return client;
      });

      const { privateKey } = await service.createApiClient('Acme', 'ops@acme.com');
      expect(savedClient.private_key_hash).not.toBe(privateKey);
      expect(savedClient.private_key_hash).toHaveLength(64); // SHA-256 hex
    });
  });

  // ─── validateApiKey ────────────────────────────────────────────────────────

  describe('validateApiKey', () => {
    it('throws UnauthorizedException when key is missing', async () => {
      await expect(service.validateApiKey('')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws when API key is not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.validateApiKey('bad-key')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws when client is suspended', async () => {
      repo.findOne.mockResolvedValue({ status: ApiClientStatus.SUSPENDED });
      await expect(service.validateApiKey('key')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns the client when key is valid and active', async () => {
      const client = { status: ApiClientStatus.ACTIVE, id: 'abc' };
      repo.findOne.mockResolvedValue(client);
      await expect(service.validateApiKey('valid-key')).resolves.toEqual(client);
    });
  });

  // ─── validateHmacSignature ────────────────────────────────────────────────

  describe('validateHmacSignature', () => {
    it('throws when required headers are missing', async () => {
      await expect(
        service.validateHmacSignature('', 'sig', String(Date.now()), '{}'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws when timestamp is expired', async () => {
      const oldTs = String(Date.now() - 400_000);
      await expect(
        service.validateHmacSignature('pub', 'sig', oldTs, '{}'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws when public key is not found', async () => {
      repo.findOne.mockResolvedValue(null);
      const ts = String(Date.now());
      await expect(
        service.validateHmacSignature('unknown', 'sig', ts, '{}'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws when signature is invalid', async () => {
      const privateKey = 'secret';
      const privateKeyHash = crypto.createHash('sha256').update(privateKey).digest('hex');
      repo.findOne.mockResolvedValue({ status: ApiClientStatus.ACTIVE, private_key_hash: privateKeyHash });
      const ts = String(Date.now());

      await expect(
        service.validateHmacSignature('pub', 'wrong-signature', ts, '{}'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns client when signature is valid', async () => {
      const privateKey = 'my-secret-key';
      const privateKeyHash = crypto.createHash('sha256').update(privateKey).digest('hex');
      const client = { status: ApiClientStatus.ACTIVE, private_key_hash: privateKeyHash, id: 'c1' };
      repo.findOne.mockResolvedValue(client);

      const ts = String(Date.now());
      const body = '{"amount":100}';
      const message = `${ts}${body}`;
      const signature = crypto.createHmac('sha256', privateKeyHash).update(message).digest('hex');

      await expect(
        service.validateHmacSignature('pub', signature, ts, body),
      ).resolves.toEqual(client);
    });
  });

  // ─── hasPermission ────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    const base = { permissions: ['accounts:read', 'transfers:read'] } as ApiClient;

    it('returns true for a granted permission', () => {
      expect(service.hasPermission(base, 'accounts:read')).toBe(true);
    });

    it('returns false for a missing permission', () => {
      expect(service.hasPermission(base, 'accounts:write')).toBe(false);
    });

    it('returns true when client has wildcard permission', () => {
      const admin = { permissions: ['*'] } as ApiClient;
      expect(service.hasPermission(admin, 'anything:write')).toBe(true);
    });
  });
});
