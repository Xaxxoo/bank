import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1783317749571 implements MigrationInterface {
    name = 'InitialSchema1783317749571'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Enum types must be created before the tables that reference them
        await queryRunner.query(`CREATE TYPE "public"."api_clients_status_enum" AS ENUM('active', 'suspended', 'revoked')`);
        await queryRunner.query(`CREATE TYPE "public"."accounts_account_type_enum" AS ENUM('prefix', 'postfix')`);
        await queryRunner.query(`CREATE TYPE "public"."accounts_status_enum" AS ENUM('active', 'frozen', 'closed')`);
        await queryRunner.query(`CREATE TYPE "public"."ledger_entries_type_enum" AS ENUM('debit', 'credit')`);
        await queryRunner.query(`CREATE TYPE "public"."transactions_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed', 'reversed')`);
        await queryRunner.query(`CREATE TYPE "public"."transactions_channel_enum" AS ENUM('internal', 'nibss', 'vas')`);
        await queryRunner.query(`CREATE TABLE "api_clients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_name" character varying NOT NULL, "business_email" character varying NOT NULL, "api_key" character varying(64) NOT NULL, "public_key" character varying(64) NOT NULL, "private_key_hash" character varying NOT NULL, "status" "public"."api_clients_status_enum" NOT NULL DEFAULT 'active', "permissions" text NOT NULL DEFAULT '', "webhook_url" character varying, "webhook_events" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ef2d5ef0eb5e9a6ddc67cfa310e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_07a58be3f0c4a852517b4d0287" ON "api_clients" ("api_key") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5746550dd74f3aaaa550fedee5" ON "api_clients" ("public_key") `);
        await queryRunner.query(`CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "account_number" character varying(10) NOT NULL, "account_type" "public"."accounts_account_type_enum" NOT NULL, "customer_name" character varying NOT NULL, "customer_phone" character varying NOT NULL, "customer_email" character varying NOT NULL, "bvn" character varying(11) NOT NULL, "balance_kobo" bigint NOT NULL DEFAULT '0', "status" "public"."accounts_status_enum" NOT NULL DEFAULT 'active', "reference" character varying NOT NULL, "api_client_id" uuid NOT NULL, "provider_account_id" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ffd1ae96513bfb2c6eada0f7d3" ON "accounts" ("account_number") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_985d51e8056e06e94072ae0382" ON "accounts" ("reference") `);
        await queryRunner.query(`CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "account_id" uuid NOT NULL, "transaction_id" character varying NOT NULL, "type" "public"."ledger_entries_type_enum" NOT NULL, "amount_kobo" bigint NOT NULL, "balance_before_kobo" bigint NOT NULL, "balance_after_kobo" bigint NOT NULL, "narration" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b26c5ef5853fd6e0a8680427f6" ON "ledger_entries" ("transaction_id") `);
        await queryRunner.query(`CREATE TABLE "transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying NOT NULL, "debit_account_number" character varying NOT NULL, "credit_account_number" character varying, "beneficiary_bank_code" character varying, "amount_kobo" bigint NOT NULL, "narration" text, "status" "public"."transactions_status_enum" NOT NULL DEFAULT 'pending', "channel" "public"."transactions_channel_enum" NOT NULL, "nibss_session_id" character varying, "provider_reference" character varying, "provider_response" jsonb, "failure_reason" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dd85cc865e0c3d5d4be095d3f3" ON "transactions" ("reference") `);
        await queryRunner.query(`ALTER TABLE "accounts" ADD CONSTRAINT "FK_bc2170559fe6030a3c77a59ea0c" FOREIGN KEY ("api_client_id") REFERENCES "api_clients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ledger_entries" ADD CONSTRAINT "FK_e4440167e470be69f9622c1ceab" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ledger_entries" DROP CONSTRAINT "FK_e4440167e470be69f9622c1ceab"`);
        await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_bc2170559fe6030a3c77a59ea0c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dd85cc865e0c3d5d4be095d3f3"`);
        await queryRunner.query(`DROP TABLE "transactions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b26c5ef5853fd6e0a8680427f6"`);
        await queryRunner.query(`DROP TABLE "ledger_entries"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_985d51e8056e06e94072ae0382"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ffd1ae96513bfb2c6eada0f7d3"`);
        await queryRunner.query(`DROP TABLE "accounts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5746550dd74f3aaaa550fedee5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_07a58be3f0c4a852517b4d0287"`);
        await queryRunner.query(`DROP TABLE "api_clients"`);
        await queryRunner.query(`DROP TYPE "public"."transactions_channel_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transactions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ledger_entries_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."accounts_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."accounts_account_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."api_clients_status_enum"`);
    }

}
