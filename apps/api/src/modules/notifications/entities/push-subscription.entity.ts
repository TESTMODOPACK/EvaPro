import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * PushSubscription — almacena las suscripciones web-push de cada dispositivo.
 *
 * Cada suscripción corresponde a un navegador/dispositivo particular. Un
 * usuario puede tener N (celular Chrome, PC Firefox, tablet Safari, etc.).
 *
 * El `endpoint` es la URL del push service (FCM para Chrome/Edge, Mozilla
 * para Firefox, WebPush para Safari). `p256dh` y `auth` son claves de
 * cifrado E2E del Web Push Protocol (RFC 8291): solo el browser suscrito
 * puede descifrar lo que el servidor firmó con la VAPID private key.
 */
@Entity('push_subscriptions')
@Index('idx_push_subs_user_tenant', ['userId', 'tenantId'])
@Index('idx_push_subs_last_used', ['lastUsedAt'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'tenant_id' })
  tenantId: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** URL única del push service que identifica esta suscripción. */
  @Column('text', { unique: true })
  endpoint: string;

  /** Public key del cliente (base64url) para cifrar el payload. */
  @Column('text')
  p256dh: string;

  /** Auth secret del cliente (base64url) para autenticar el mensaje. */
  @Column('text')
  auth: string;

  /** User-Agent del browser al momento de suscribirse (anonimizado si es necesario). */
  @Column('text', { nullable: true, name: 'user_agent' })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Última vez que se envió push exitosamente a este endpoint. */
  @Column('timestamp', { nullable: true, name: 'last_used_at' })
  lastUsedAt: Date | null;

  /** Última vez que el envío falló. */
  @Column('timestamp', { nullable: true, name: 'last_failure_at' })
  lastFailureAt: Date | null;

  /** Número de fallos consecutivos. Si supera el umbral (5), se borra. */
  @Column('int', { default: 0, name: 'failure_count' })
  failureCount: number;
}
