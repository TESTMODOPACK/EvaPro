import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('users')
@Unique(['tenantId', 'email'])
@Index('idx_users_tenant', ['tenantId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 50 })
  role: string; // 'super_admin' | 'tenant_admin' | 'manager' | 'employee' | 'external'

  @Column({ type: 'uuid', nullable: true, name: 'manager_id' })
  managerId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  position: string;

  @Column({ type: 'date', nullable: true, name: 'hire_date' })
  hireDate: Date;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  // ─── Demographic fields (optional, for DEI analytics) ─────────────

  @Column({ type: 'varchar', length: 20, nullable: true, comment: 'masculino|femenino|no_binario|prefiero_no_decir' })
  gender: string | null;

  @Column({ type: 'date', nullable: true, name: 'birth_date' })
  birthDate: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nationality: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'seniority_level', comment: 'junior|mid|senior|lead|director|executive' })
  seniorityLevel: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'contract_type', comment: 'indefinido|plazo_fijo|honorarios|practicante' })
  contractType: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'work_location', comment: 'oficina|remoto|hibrido' })
  workLocation: string | null;

  // ─── End demographic fields ───────────────────────────────────────

  @Column({ type: 'varchar', length: 5, default: 'es', nullable: true })
  language: string;

  @Column({ type: 'varchar', length: 10, nullable: true, name: 'reset_code' })
  resetCode: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'reset_code_expires' })
  resetCodeExpires: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
