import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Department } from '../../tenants/entities/department.entity';
import { Position } from '../../tenants/entities/position.entity';

@Entity('users')
@Unique(['tenantId', 'email'])
@Index('idx_users_tenant', ['tenantId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // tenantId puede ser NULL en DB para super_admin (jwt.strategy:45-48 lo
  // permite explícitamente). Mantenemos el tipo TS como `string` para no
  // rompede los ~40 consumidores existentes que asumen string; los sitios que
  // chequean explícitamente super_admin (jwt.strategy, auth.service.refreshToken)
  // ya manejan el caso null con `tenantId || null`. El `as any` en los callers
  // que hacen `tenantId: null` sigue funcionando con nullable:true en la columna.
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
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

  @Column({ type: 'varchar', length: 12, nullable: true })
  rut: string | null;

  @Column({ type: 'varchar', length: 50 })
  role: string; // 'super_admin' | 'tenant_admin' | 'manager' | 'employee' | 'external'

  @Column({ type: 'uuid', nullable: true, name: 'manager_id' })
  managerId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User;

  /**
   * Sprint 4 BR-A.4 — Matrix reporting (dotted-line managers).
   *
   * Lista de managers SECUNDARIOS (jefe funcional, jefe de proyecto, etc.).
   * El primary manager (managerId arriba) es el jefe formal de RRHH.
   * Los secondary managers son adicionales — empresas matriciales donde
   * un colaborador reporta a múltiples lideres en distintos roles.
   *
   * Reglas (BR-A.4):
   * - Cap 5 secondary managers (BR-A.4.5).
   * - No incluir primaryManagerId en este array (BR-A.4.6).
   * - No incluir el propio userId (BR-A.4.6).
   * - En 360°/270°: cada secondary se asigna como evaluator role MANAGER
   *   con peso compartido (cycle.settings.secondaryManagerWeightShare,
   *   default 0.33 → primary 67%, secondary 33% del peso total de manager).
   * - En 90° (rapidez): solo primary, no secondary (BR-A.4.7).
   */
  @Column({
    type: 'uuid',
    array: true,
    name: 'secondary_managers',
    default: () => "'{}'::uuid[]",
  })
  secondaryManagers: string[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string;

  @Column({ type: 'uuid', nullable: true, name: 'department_id' })
  @Index('idx_users_department_id')
  departmentId: string | null;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'department_id' })
  departmentEntity: Department;

  @Column({ type: 'varchar', length: 100, nullable: true })
  position: string;

  @Column({ type: 'uuid', nullable: true, name: 'position_id' })
  @Index('idx_users_position_id')
  positionId: string | null;

  @ManyToOne(() => Position, { nullable: true })
  @JoinColumn({ name: 'position_id' })
  positionEntity: Position;

  @Column({ type: 'int', nullable: true, name: 'hierarchy_level', comment: 'Numeric level from position catalog (1=highest). Null if free-text position.' })
  hierarchyLevel: number | null;

  @Column({ type: 'date', nullable: true, name: 'hire_date' })
  hireDate: Date;

  @Column({ type: 'date', nullable: true, name: 'departure_date', comment: 'Fecha efectiva de salida de la empresa' })
  departureDate: Date | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'boolean', default: false, name: 'must_change_password', comment: 'Forces password change on next login — set to true when admin creates user with temp password' })
  mustChangePassword: boolean;

  @Column({ type: 'boolean', default: true, name: 'leaderboard_opt_in', comment: 'User opts into gamification leaderboard' })
  leaderboardOptIn: boolean;

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

  /**
   * Preferencias de notificaciones (v3.0). JSON flexible para poder agregar
   * nuevos tipos sin migration. Estructura:
   *   {
   *     pushEnabled: boolean,
   *     pushEvents: { evaluations, checkins, objectives, feedback, recognitions, surveys },
   *     quietHours: { enabled, start: "HH:MM", end: "HH:MM", timezone },
   *     emailEnabled: boolean
   *   }
   * Si es NULL → tratar como todo habilitado (defaults conservadores).
   */
  @Column({ type: 'jsonb', nullable: true, name: 'notification_prefs' })
  notificationPrefs: {
    pushEnabled?: boolean;
    pushEvents?: Partial<Record<'evaluations' | 'checkins' | 'objectives' | 'feedback' | 'recognitions' | 'surveys', boolean>>;
    quietHours?: {
      enabled?: boolean;
      start?: string;
      end?: string;
      timezone?: string;
    };
    emailEnabled?: boolean;
  } | null;

  @Column({ type: 'varchar', length: 10, nullable: true, name: 'reset_code' })
  resetCode: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'reset_code_expires' })
  resetCodeExpires: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true, name: 'signature_otp' })
  signatureOtp: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'signature_otp_expires' })
  signatureOtpExpires: Date | null;

  // ─── 2FA / MFA fields ────────────────────────────────────────
  @Column({ type: 'boolean', default: false, name: 'two_factor_enabled' })
  twoFactorEnabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'two_factor_secret' })
  twoFactorSecret: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'notification_preferences', default: () => "'{}'" })
  notificationPreferences: Record<string, boolean> | null;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'cv_url' })
  cvUrl: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'cv_file_name' })
  cvFileName: string | null;

  /**
   * Incrementa cada vez que el usuario debe invalidar todos sus JWTs emitidos
   * (desvinculación, cambio de password, logout remoto). La estrategia JWT
   * compara este valor con el `tv` del payload y rechaza el token si no
   * coinciden. Arranca en 0 para usuarios existentes.
   */
  @Column({ type: 'int', default: 0, name: 'token_version' })
  tokenVersion: number;

  // ─── Password policy tracking (C1) ───────────────────────────────────
  /**
   * Timestamp of the last successful password change. `null` for pre-existing
   * users who haven't rotated their password since this feature shipped —
   * they're treated as "never expired" until they rotate, which is the
   * pragmatic backfill policy (don't lock out the whole base on day 1).
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'password_changed_at' })
  passwordChangedAt: Date | null;

  /** Resets to 0 on every successful login. Compared against
   *  `tenant.settings.passwordPolicy.lockoutThreshold`. */
  @Column({ type: 'int', default: 0, name: 'failed_login_attempts' })
  failedLoginAttempts: number;

  /** Null unless the user is currently locked out. We don't remove the lock
   *  eagerly — `validateUser` checks `locked_until > now` each login. */
  @Column({ type: 'timestamptz', nullable: true, name: 'locked_until' })
  lockedUntil: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
