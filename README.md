# PulseMFB API

A B2B Banking-as-a-Service (BaaS) REST API for Nigerian fintechs. Businesses use PulseMFB to create virtual NUBAN bank accounts, move money over NIBSS NIP, and purchase airtime/data — without building their own core banking integration.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Running with Docker](#running-with-docker)
- [Environment Variables](#environment-variables)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Webhooks](#webhooks)
- [Testing](#testing)
- [Database Migrations](#database-migrations)

---

## Architecture

```
src/
├── accounts/          # Virtual account lifecycle (create, freeze, close)
├── transfers/         # Fund transfers — internal routing + NIBSS NIP
├── vas/               # Value-Added Services (airtime, data)
├── webhooks/          # Event delivery to client endpoints
├── auth/              # API key + HMAC-SHA256 authentication
├── providers/
│   ├── anchor/        # Anchor BaaS integration (accounts, NIBSS NIP)
│   └── vtpass/        # VTPass integration (airtime, data)
├── workers/
│   ├── transfer-polling/    # Bull job: reconcile pending NIBSS transfers
│   └── webhook-delivery/    # Bull job: deliver events with retry/backoff
├── common/            # Guards, interceptors, filters, Redis client
├── health/            # GET /health
└── config/            # DB config, env validation
```

**Key design decisions**

| Decision | Rationale |
|---|---|
| Balances stored in kobo | Avoids floating-point precision issues |
| Idempotency via `reference` | Clients supply a unique reference; duplicates return the existing record |
| HMAC-SHA256 on write endpoints | Prevents replay attacks; timestamp tolerance is configurable |
| Bull + Redis for async work | Transfer polling and webhook delivery survive restarts and scale horizontally |

---

## Prerequisites

- Node.js 22+
- PostgreSQL 16
- Redis 7
- npm

---

## Local Development

**1. Clone and install**

```bash
git clone <repo-url>
cd bank
npm install
```

**2. Start infrastructure**

```bash
# Start only Postgres and Redis (no app container)
docker compose up postgres redis -d
```

**3. Configure environment**

```bash
cp .env.example .env
# Edit .env — fill in ANCHOR_API_KEY, VTPASS_* credentials at minimum
```

**4. Run in watch mode**

```bash
npm run start:dev
```

The API is available at `http://localhost:3000`.
Swagger docs are at `http://localhost:3000/docs`.

---

## Running with Docker

Runs the full stack (Postgres, Redis, and the API) from a single command.

```bash
# Build and start everything
docker compose up --build

# Background
docker compose up --build -d

# Tear down
docker compose down
```

The `app` service reads credentials from `.env` and automatically overrides `DB_HOST`/`REDIS_HOST` to point at the Docker service names.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | HTTP listen port |
| `DB_HOST` | **Yes** | — | Postgres host |
| `DB_PORT` | No | `5432` | Postgres port |
| `DB_USERNAME` | **Yes** | — | Postgres user |
| `DB_PASSWORD` | **Yes** | — | Postgres password |
| `DB_NAME` | **Yes** | — | Postgres database name |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `HMAC_TIMESTAMP_TOLERANCE_MS` | No | `300000` | Max request age in ms (replay attack window) |
| `ANCHOR_API_KEY` | **Yes** | — | Anchor BaaS API key |
| `ANCHOR_BASE_URL` | No | Anchor sandbox URL | Override for production |
| `VTPASS_USERNAME` | **Yes** | — | VTPass account email |
| `VTPASS_PASSWORD` | **Yes** | — | VTPass account password |
| `VTPASS_API_KEY` | **Yes** | — | VTPass API key |
| `VTPASS_BASE_URL` | No | VTPass sandbox URL | Override for production |

The app validates all required variables on startup and exits with a descriptive error if any are missing.

---

## Authentication

All endpoints are under `/api/v1/external-api/`. Two authentication schemes are used:

### API Key (read operations)

Include the `x-api-key` header on every request:

```
x-api-key: <your-api-key>
```

### HMAC-SHA256 (write operations)

Write endpoints (account creation, transfers, webhook config updates) require three additional headers:

| Header | Value |
|---|---|
| `x-public-key` | Your public key |
| `x-timestamp` | Current Unix timestamp in milliseconds (`Date.now()`) |
| `x-signature` | HMAC-SHA256 signature (see below) |

**Computing the signature**

```
signature = HMAC-SHA256(privateKeyHash, timestamp + requestBody)
```

- `privateKeyHash` is the SHA-256 hex hash of your private key (as returned at client creation — store it securely, it is never stored in plaintext)
- `timestamp` is the value you send in `x-timestamp`
- `requestBody` is the raw JSON string of the request body

```js
const crypto = require('crypto');

const timestamp = Date.now().toString();
const body = JSON.stringify({ customer_name: 'Amina Bello', ... });
const message = timestamp + body;

const signature = crypto
  .createHmac('sha256', privateKeyHash)
  .update(message)
  .digest('hex');
```

Requests older than `HMAC_TIMESTAMP_TOLERANCE_MS` (default 5 minutes) are rejected.

### Permissions

Each API client has a scoped permissions list. Available scopes:

```
accounts:read   accounts:write
transfers:read  transfers:write
vas:read        vas:write
```

Use `*` to grant all permissions (admin clients only).

---

## API Reference

Interactive Swagger docs are served at `/docs` when the app is running.

### Account Management

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/external-api/accounts/prefix` | HMAC | Create a virtual NUBAN account |
| `GET` | `/external-api/accounts/:account_number` | API Key | Get account details |
| `GET` | `/external-api/accounts/:account_number/balance` | API Key | Get live balance |
| `PATCH` | `/external-api/accounts/:account_number/freeze` | HMAC | Freeze account |
| `PATCH` | `/external-api/accounts/:account_number/unfreeze` | HMAC | Unfreeze account |
| `PATCH` | `/external-api/accounts/:account_number/close` | HMAC | Permanently close account |

### Transfers

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/external-api/transfers/name-enquiry` | API Key | Verify beneficiary name (NIBSS) |
| `POST` | `/external-api/transfers` | API Key | Initiate a transfer |
| `GET` | `/external-api/transfers` | API Key | List transfers (`?status=&page=&limit=`) |
| `GET` | `/external-api/transfers/:reference` | API Key | Get a single transfer |
| `PATCH` | `/external-api/transfers/:reference/reverse` | API Key | Reverse a completed transfer |

Transfer routing is automatic:
- **Internal**: beneficiary account exists in PulseMFB → settled instantly
- **External**: routes via Anchor → NIBSS NIP; status polled asynchronously every 30 seconds

### Value-Added Services

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/external-api/vas/airtime` | API Key | Purchase airtime |
| `GET` | `/external-api/vas/data/bundles` | HMAC | List data bundles by operator |
| `POST` | `/external-api/vas/data` | API Key | Purchase a data bundle |
| `GET` | `/external-api/vas/transactions` | API Key | List VAS transactions |
| `GET` | `/external-api/vas/transactions/:reference` | API Key | Get a VAS transaction |

Supported operators: `mtn`, `glo`, `airtel`, `etisalat` (airtime); `mtn-data`, `glo-data`, `airtel-data`, `etisalat-data` (data).

### Webhooks

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/external-api/webhooks` | API Key | Get current webhook config |
| `PATCH` | `/external-api/webhooks` | HMAC | Update webhook URL and events |

### Health

```
GET /api/v1/health
```

No authentication required. Returns PostgreSQL and Redis connectivity status.

---

## Webhooks

After subscribing, PulseMFB will `POST` a signed payload to your endpoint for each event.

**Subscribing**

```json
PATCH /api/v1/external-api/webhooks
{
  "webhook_url": "https://yourservice.com/webhook",
  "events": ["transfer.completed", "transfer.failed", "account.created"]
}
```

**Available events**

| Event | Trigger |
|---|---|
| `transfer.completed` | Transfer settled successfully |
| `transfer.failed` | Transfer failed after reconciliation |
| `transfer.reversed` | Transfer manually reversed |
| `account.created` | New virtual account created |
| `vas.completed` | Airtime or data purchase succeeded |
| `vas.failed` | Airtime or data purchase failed |

**Payload format**

```json
{
  "event": "transfer.completed",
  "data": { ... },
  "timestamp": "2026-07-08T10:00:00.000Z"
}
```

**Verifying the signature**

Every delivery includes an `x-pulsemfb-signature` header. Verify it to confirm the request came from PulseMFB:

```js
const crypto = require('crypto');

const body = req.rawBody;           // raw JSON string
const signature = req.headers['x-pulsemfb-signature'];

const expected = crypto
  .createHmac('sha256', yourPrivateKeyHash)
  .update(body)
  .digest('hex');

if (signature !== expected) {
  return res.status(401).send('Invalid signature');
}
```

**Retry policy**: 5 attempts with exponential backoff (5 s, 10 s, 20 s, 40 s, 80 s). Failed jobs are retained in Redis for inspection.

---

## Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e
```

---

## Database Migrations

In development (`NODE_ENV=development`), TypeORM syncs the schema automatically.

In all other environments, migrations must be run explicitly:

```bash
# Run pending migrations
npm run migration:run

# Generate a new migration after changing an entity
npm run migration:generate -- src/database/migrations/MyMigrationName

# Revert the last migration
npm run migration:revert

# Show migration status
npm run migration:show
```

> Migration files live in `src/database/migrations/` and must be committed to the repository.
