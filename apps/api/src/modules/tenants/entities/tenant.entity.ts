import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('tenants')
@Unique(['slug'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  slug: string;

  @Column({ type: 'varchar', length: 12, unique: true, nullable: true })
  rut: string | null;

  @Column({ type: 'varchar', length: 50, default: 'starter' })
  plan: string;

  @Column({ type: 'varchar', length: 20, name: 'owner_type' })
  ownerType: string; // 'company' | 'consultant'

  @Column({ type: 'int', default: 50, name: 'max_employees' })
  maxEmployees: number;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'employee_range' })
  employeeRange: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true, name: 'commercial_address' })
  commercialAddress: string | null;

  @Column({ type: 'jsonb', default: {} })
  settings: any;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
