import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Account } from './account.entity';

export enum EntryType {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column()
  account_id: string;

  @Index()
  @Column()
  transaction_id: string;

  @Column({ type: 'enum', enum: EntryType })
  type: EntryType;

  // Stored in kobo
  @Column({ type: 'bigint' })
  amount_kobo: number;

  @Column({ type: 'bigint' })
  balance_before_kobo: number;

  @Column({ type: 'bigint' })
  balance_after_kobo: number;

  @Column({ type: 'text' })
  narration: string;

  @CreateDateColumn()
  created_at: Date;
}
