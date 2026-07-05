import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiClient } from './api-client.entity';

export enum AccountType {
  PREFIX = 'prefix',
  POSTFIX = 'postfix',
}

export enum AccountStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  CLOSED = 'closed',
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 10 })
  account_number: string;

  @Column({ type: 'enum', enum: AccountType })
  account_type: AccountType;

  @Column()
  customer_name: string;

  @Column()
  customer_phone: string;

  @Column()
  customer_email: string;

  @Column({ length: 11 })
  bvn: string;

  // Balance stored in kobo (smallest unit) to avoid float precision issues
  @Column({ type: 'bigint', default: 0 })
  balance_kobo: number;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status: AccountStatus;

  @Index({ unique: true })
  @Column()
  reference: string;

  // The API client that created this account
  @ManyToOne(() => ApiClient)
  @JoinColumn({ name: 'api_client_id' })
  api_client: ApiClient;

  @Column()
  api_client_id: string;

  // Anchor/BaaS virtual account reference
  @Column({ nullable: true })
  provider_account_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
