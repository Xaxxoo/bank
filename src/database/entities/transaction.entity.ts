import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

export enum TransactionChannel {
  INTERNAL = 'internal',
  NIBSS = 'nibss',
  VAS = 'vas',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  reference: string;

  @Column()
  debit_account_number: string;

  @Column({ nullable: true })
  credit_account_number: string;

  @Column({ nullable: true })
  beneficiary_bank_code: string;

  // Amount in kobo
  @Column({ type: 'bigint' })
  amount_kobo: number;

  @Column({ type: 'text', nullable: true })
  narration: string;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  @Column({ type: 'enum', enum: TransactionChannel })
  channel: TransactionChannel;

  // NIBSS NIP session ID for external transfers
  @Column({ nullable: true })
  nibss_session_id: string;

  // Provider (Anchor) transaction reference
  @Column({ nullable: true })
  provider_reference: string;

  // Full provider response stored for audit/dispute resolution
  @Column({ type: 'jsonb', nullable: true })
  provider_response: Record<string, any>;

  @Column({ nullable: true })
  failure_reason: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
