import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_lines')
export class InvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (inv) => inv.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'varchar', length: 300 })
  concept: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'unit_price' })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
