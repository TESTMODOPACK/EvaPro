import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import { v2 as cloudinary } from 'cloudinary';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

/**
 * Maximum uncompressed payload size per export. Prevents OOM on a tenant
 * export that tries to dump 100k evaluations — we truncate and attach a
 * TRUNCATED.txt notice so the user knows to contact support.
 *
 * 80 MB uncompressed typically compresses to 15-25 MB ZIP, which stays below
 * the 100 MB Cloudinary single-file upload comfort zone on the raw endpoint.
 */
const MAX_BYTES = 80 * 1024 * 1024;

/**
 * Per-table LIMIT in tenant exports. Individual user exports do NOT apply
 * this (one user's history is small). Tenant exports use it to cap the
 * worst-case size; exceeding it appends a "truncated" notice.
 */
const TENANT_ROW_LIMIT = 5000;

export interface UserExportResult {
  buffer: Buffer;
  sizeBytes: number;
  fileCount: number;
  truncated: boolean;
}

/**
 * Builds the ZIP payload for GDPR export requests. Kept separate from the
 * controller/service orchestrator so it can be unit-tested with a stub
 * DataSource.
 */
@Injectable()
export class GdprExportBuilder {
  private readonly logger = new Logger(GdprExportBuilder.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
  ) {
    // Configure cloudinary once; reusing UploadsService would introduce a
    // module dependency we don't want. The env-based config is idempotent.
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    }
  }

  // ─── User-scoped export ──────────────────────────────────────────────────

  async buildUserExport(userId: string): Promise<UserExportResult> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const files = new Map<string, string>();
    let truncated = false;

    // profile.json — strip secrets & credentials
    const safeProfile = this.stripUserSecrets(user);
    files.set('profile.json', JSON.stringify(safeProfile, null, 2));

    // Per-domain JSONs. Each uses raw SQL so we don't have to inject 20
    // repositories; we're only reading and we know the schema.
    const queries: Array<{
      name: string;
      sql: string;
      params: unknown[];
    }> = [
      {
        name: 'evaluations.json',
        sql: `SELECT a.*, r.answers, r.overall_score, r.submitted_at
              FROM evaluation_assignments a
              LEFT JOIN evaluation_responses r ON r.assignment_id = a.id
              WHERE a.evaluatee_id = $1 OR a.evaluator_id = $1
              ORDER BY a.created_at DESC`,
        params: [userId],
      },
      {
        name: 'objectives.json',
        sql: `SELECT * FROM objectives WHERE user_id = $1 ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'feedback.json',
        sql: `SELECT * FROM quick_feedbacks
              WHERE from_user_id = $1 OR to_user_id = $1
              ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'checkins.json',
        sql: `SELECT * FROM checkins
              WHERE employee_id = $1 OR manager_id = $1
              ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'recognitions.json',
        sql: `SELECT * FROM recognitions
              WHERE from_user_id = $1 OR to_user_id = $1
              ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'development-plans.json',
        sql: `SELECT * FROM development_plans WHERE user_id = $1 ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'points.json',
        sql: `SELECT * FROM user_points WHERE user_id = $1 ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'badges.json',
        sql: `SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at DESC`,
        params: [userId],
      },
      {
        name: 'notifications.json',
        sql: `SELECT * FROM notifications
              WHERE user_id = $1
                AND created_at > now() - interval '90 days'
              ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'audit-log.json',
        sql: `SELECT id, action, entity_type, entity_id, metadata, ip_address, created_at
              FROM audit_logs
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT 10000`,
        params: [userId],
      },
      {
        name: 'user-notes.json',
        sql: `SELECT * FROM user_notes WHERE user_id = $1 ORDER BY created_at DESC`,
        params: [userId],
      },
      {
        name: 'movements.json',
        sql: `SELECT * FROM user_movements WHERE user_id = $1 ORDER BY effective_date DESC`,
        params: [userId],
      },
    ];

    for (const q of queries) {
      try {
        const rows = await this.dataSource.query(q.sql, q.params);
        files.set(q.name, JSON.stringify(rows ?? [], null, 2));
      } catch (err: any) {
        // A missing table shouldn't abort the export — just note it.
        this.logger.warn(`Export query failed (${q.name}): ${err?.message || err}`);
        files.set(q.name, JSON.stringify([], null, 2));
      }
    }

    // README that explains what each file is and the user's rights.
    files.set('README.txt', this.buildReadme('user', user));

    const { buffer, sizeBytes, truncated: trunc } = await this.zipFiles(files);
    return {
      buffer,
      sizeBytes,
      fileCount: files.size,
      truncated: trunc,
    };
  }

  // ─── Tenant-scoped export ────────────────────────────────────────────────

  async buildTenantExport(tenantId: string, opts: { anonymize: boolean }): Promise<UserExportResult> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const files = new Map<string, string>();
    let truncated = false;

    // Tenant-level tables. For each, we paginate with a hard limit to cap
    // worst-case size and mark truncated:true in the output if we hit it.
    const tenantQueries: Array<{
      name: string;
      sql: string;
    }> = [
      { name: 'tenant.json', sql: `SELECT * FROM tenants WHERE id = $1` },
      { name: 'users.json', sql: `SELECT * FROM users WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'departments.json', sql: `SELECT * FROM departments WHERE tenant_id = $1` },
      { name: 'positions.json', sql: `SELECT * FROM positions WHERE tenant_id = $1` },
      { name: 'evaluation-cycles.json', sql: `SELECT * FROM evaluation_cycles WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'evaluation-assignments.json', sql: `SELECT * FROM evaluation_assignments WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'evaluation-responses.json', sql: `SELECT * FROM evaluation_responses WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'objectives.json', sql: `SELECT * FROM objectives WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'feedback.json', sql: `SELECT * FROM quick_feedbacks WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'checkins.json', sql: `SELECT * FROM checkins WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'recognitions.json', sql: `SELECT * FROM recognitions WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'development-plans.json', sql: `SELECT * FROM development_plans WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'development-actions.json', sql: `SELECT * FROM development_actions WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
      { name: 'audit-log.json', sql: `SELECT id, user_id, action, entity_type, entity_id, metadata, ip_address, created_at FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50000` },
      { name: 'contracts.json', sql: `SELECT * FROM contracts WHERE tenant_id = $1` },
      { name: 'subscriptions.json', sql: `SELECT * FROM subscriptions WHERE tenant_id = $1` },
      { name: 'invoices.json', sql: `SELECT * FROM invoices WHERE tenant_id = $1 LIMIT ${TENANT_ROW_LIMIT}` },
    ];

    // Optional anonymization map: userId -> "Usuario 1", etc. Built lazily.
    const pseudoMap = new Map<string, string>();
    let pseudoCounter = 0;
    const pseudonymize = (s: string): string => {
      if (!pseudoMap.has(s)) {
        pseudoCounter++;
        pseudoMap.set(s, `Usuario ${pseudoCounter}`);
      }
      return pseudoMap.get(s)!;
    };

    for (const q of tenantQueries) {
      try {
        const rows = await this.dataSource.query(q.sql, [tenantId]);
        let records = rows ?? [];
        // Truncation detection is approximate: if the row count equals the
        // LIMIT we assume we capped. Callers can verify in the output.
        const maybeTruncated =
          Array.isArray(records) &&
          (q.sql.includes(`LIMIT ${TENANT_ROW_LIMIT}`) ? records.length === TENANT_ROW_LIMIT : false);
        if (maybeTruncated) truncated = true;

        if (opts.anonymize && q.name === 'users.json') {
          records = records.map((u: any) => ({
            ...u,
            first_name: pseudonymize(u.id),
            last_name: '',
            email: `anon_${u.id.slice(0, 8)}@anon.local`,
            rut: null,
            birth_date: null,
            phone: null,
            // keep role/dept/position/dates for analysis
          }));
        }
        files.set(q.name, JSON.stringify(records, null, 2));
      } catch (err: any) {
        this.logger.warn(`Tenant export query failed (${q.name}): ${err?.message || err}`);
        files.set(q.name, JSON.stringify([], null, 2));
      }
    }

    files.set('README.txt', this.buildReadme('tenant', null, tenant, opts.anonymize));
    if (truncated) {
      files.set(
        'TRUNCATED.txt',
        [
          'Este export contiene algunas tablas truncadas a ' +
            TENANT_ROW_LIMIT +
            ' filas por razones de tamaño.',
          'Para obtener un export completo, contacta al equipo de soporte de Eva360.',
          'Los archivos con el máximo número de filas indican posible truncación.',
        ].join('\n'),
      );
    }

    const result = await this.zipFiles(files);
    return {
      buffer: result.buffer,
      sizeBytes: result.sizeBytes,
      fileCount: files.size,
      truncated: truncated || result.truncated,
    };
  }

  // ─── Cloudinary upload ───────────────────────────────────────────────────

  /**
   * Uploads the ZIP buffer to Cloudinary and returns the secure URL. Raises
   * a descriptive Error if Cloudinary is not configured so the caller can
   * mark the GdprRequest as 'failed' with a readable message.
   */
  async uploadZip(buffer: Buffer, scope: 'user' | 'tenant', ownerId: string): Promise<{ url: string; publicId: string }> {
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      throw new Error('Cloudinary no está configurado. Agrega CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.');
    }
    // Folder segregates GDPR exports from other uploads so a periodic cleanup
    // (future) can target them without touching user CVs etc.
    const folder = `evapro/gdpr-exports/${scope}`;
    // Random UUID in public_id prevents anyone from guessing URLs belonging
    // to another user. We still track expiry in the DB as the authoritative
    // lifetime signal.
    const publicId = `${ownerId}_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'raw', // ZIP is not an image/video
          public_id: publicId,
          use_filename: false,
          unique_filename: false,
          overwrite: false,
        },
        (err, result) => {
          if (err) return reject(new Error(`Cloudinary upload failed: ${err.message}`));
          if (!result) return reject(new Error('Cloudinary returned empty result'));
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private stripUserSecrets(user: User): Partial<User> {
    // The rest.* is fine to emit; we only drop things that should NEVER leave
    // the database as plain text.
    const {
      passwordHash,
      twoFactorSecret,
      resetCode,
      resetCodeExpires,
      signatureOtp,
      signatureOtpExpires,
      tokenVersion,
      ...rest
    } = user as any;
    return rest;
  }

  private buildReadme(
    scope: 'user' | 'tenant',
    user: User | null,
    tenant?: Tenant,
    anonymized?: boolean,
  ): string {
    const header = [
      'Eva360 — Export de datos personales',
      '=====================================',
      `Fecha de generación: ${new Date().toISOString()}`,
      scope === 'user' && user ? `Usuario: ${user.firstName} ${user.lastName} <${user.email}>` : '',
      scope === 'tenant' && tenant ? `Organización: ${tenant.name}` : '',
      anonymized ? 'Anonimización aplicada: SÍ (nombres, emails y RUTs reemplazados por pseudónimos).' : '',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    const body =
      scope === 'user'
        ? `\nContenido:
-----------
- profile.json         : tus datos de perfil (sin credenciales).
- evaluations.json     : asignaciones y respuestas donde has participado como evaluado/evaluador.
- objectives.json      : tus objetivos (OKRs/SMART).
- feedback.json        : feedback que enviaste o recibiste.
- checkins.json        : reuniones 1:1 como employee o manager.
- recognitions.json    : reconocimientos públicos enviados/recibidos.
- development-plans.json: tus planes de desarrollo (PDI) y acciones.
- points.json / badges.json : gamificación acumulada.
- notifications.json   : últimos 90 días de notificaciones in-app.
- audit-log.json       : trazas de auditoría asociadas a tus acciones.
- user-notes.json      : notas privadas de RRHH sobre ti (si las hay).
- movements.json       : cambios de cargo/jefatura.

Tus derechos:
-------------
Conforme al RGPD (UE), Ley 19.628 (Chile), LGPD (Brasil), Ley 1581 (Colombia)
y normativas equivalentes, tienes derecho a:
- Solicitar rectificación de datos incorrectos.
- Solicitar supresión (eliminación) de tu cuenta desde /perfil.
- Oponerte al tratamiento de ciertos datos.
- Portabilidad: usar este archivo para transferir tus datos a otro sistema.

Para cualquier consulta, contacta al equipo de soporte o al DPO de tu organización.`
        : `\nContenido (export de la organización):
---------------------------------------
Archivos por dominio (tenant.json, users.json, evaluation-cycles.json, etc.).

Este export incluye datos personales identificables salvo que hayas activado
la opción "Anonimizar datos de empleados". Úsalo exclusivamente conforme a las
políticas de protección de datos aplicables a tu organización.

El archivo audit-log.json contiene un máximo de 50.000 entradas recientes.
Otros archivos grandes pueden estar truncados a ${TENANT_ROW_LIMIT} filas;
ver TRUNCATED.txt si está presente.`;

    return header + body + '\n';
  }

  private zipFiles(files: Map<string, string>): Promise<{
    buffer: Buffer;
    sizeBytes: number;
    truncated: boolean;
  }> {
    return new Promise((resolve, reject) => {
      // archiver v7 is CJS but default import works thanks to esModuleInterop.
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      let totalRaw = 0;
      let truncated = false;

      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('error', (err: Error) => reject(err));
      archive.on('end', () =>
        resolve({
          buffer: Buffer.concat(chunks),
          sizeBytes: chunks.reduce((sum, c) => sum + c.length, 0),
          truncated,
        }),
      );

      for (const [name, content] of files) {
        const size = Buffer.byteLength(content, 'utf8');
        if (totalRaw + size > MAX_BYTES) {
          truncated = true;
          archive.append(
            `Este archivo fue omitido porque el export superó el tamaño máximo.\n`,
            { name: `SKIPPED_${name}.txt` },
          );
          continue;
        }
        totalRaw += size;
        archive.append(content, { name });
      }

      archive.finalize().catch(reject);
    });
  }
}
