import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { OrgDevelopmentInitiative } from './org-development-initiative.entity';

/**
 * Join table normalizing the old `org_development_initiatives.participant_ids`
 * JSONB array. Each row is one (initiative, user) membership.
 *
 * Why this exists:
 *   Storing participants as a JSONB string[] made queries like "which
 *   initiatives is user X in?" O(scan). Normalizing lets PostgreSQL index
 *   and join properly and aligns with the rest of the tenant-scoped schema.
 *
 * Migration path:
 *   - OrgDevelopmentInitiative.participantIds is kept for backward-compat.
 *   - org-development.service writes to BOTH (dual-write) so readers can
 *     pick whichever works and legacy queries keep functioning.
 *   - Once all callers read from this table, the JSONB can be dropped.
 */
@Entity('org_dev_initiative_participants')
@Index('idx_odip_tenant', ['tenantId'])
@Index('idx_odip_initiative', ['initiativeId'])
@Index('idx_odip_user', ['tenantId', 'userId'])
@Unique('uq_odip_initiative_user', ['initiativeId', 'userId'])
export class OrgDevInitiativeParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId: string;

  @ManyToOne(() => OrgDevelopmentInitiative, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative: OrgDevelopmentInitiative;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
