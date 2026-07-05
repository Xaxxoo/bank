import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ApiClientStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

@Entity('api_clients')
export class ApiClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  business_name: string;

  @Column()
  business_email: string;

  // x-api-key: used for read operations (balance, account details)
  @Index({ unique: true })
  @Column({ length: 64 })
  api_key: string;

  // x-public-key: used for HMAC signed requests (create account, sensitive writes)
  @Index({ unique: true })
  @Column({ length: 64 })
  public_key: string;

  // private_key: stored hashed, shared with client once at creation — used to sign HMAC
  @Column()
  private_key_hash: string;

  @Column({ type: 'enum', enum: ApiClientStatus, default: ApiClientStatus.ACTIVE })
  status: ApiClientStatus;

  // Granular permissions (e.g. ["accounts:write", "transfers:write", "vas:read"])
  @Column({ type: 'simple-array', default: '' })
  permissions: string[];

  @Column({ nullable: true })
  webhook_url: string;

  @Column({ type: 'simple-array', nullable: true })
  webhook_events: string[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
