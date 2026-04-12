import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from './entities/contract.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

const CONTRACT_TYPES = [
  { type: 'service_agreement', label: 'Contrato de Prestación de Servicios' },
  { type: 'dpa', label: 'Acuerdo de Procesamiento de Datos (DPA)' },
  { type: 'terms_conditions', label: 'Términos y Condiciones de Uso' },
  { type: 'privacy_policy', label: 'Política de Privacidad' },
  { type: 'sla', label: 'Acuerdo de Nivel de Servicio (SLA)' },
  { type: 'nda', label: 'Acuerdo de Confidencialidad (NDA)' },
  { type: 'amendment', label: 'Enmienda / Addendum' },
];

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  getContractTypes() {
    return CONTRACT_TYPES;
  }

  async create(dto: {
    tenantId: string;
    type: string;
    title: string;
    description?: string;
    content?: string;
    fileUrl?: string;
    effectiveDate: string;
    expirationDate?: string;
    parentContractId?: string;
  }, createdBy: string): Promise<Contract> {
    if (!CONTRACT_TYPES.some(t => t.type === dto.type)) {
      throw new BadRequestException(`Tipo de contrato no válido: ${dto.type}`);
    }
    const contract = this.contractRepo.create({
      tenantId: dto.tenantId,
      type: dto.type,
      title: dto.title,
      description: dto.description || null,
      content: dto.content || null,
      fileUrl: dto.fileUrl || null,
      effectiveDate: new Date(dto.effectiveDate),
      expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : null,
      parentContractId: dto.parentContractId || null,
      createdBy,
      status: 'draft',
    });
    const saved = await this.contractRepo.save(contract);
    await this.auditService.log(dto.tenantId, createdBy, 'contract.created', 'contract', saved.id, { type: dto.type, title: dto.title }).catch(() => {});
    this.notifyAdminOnContractChange(saved.id, 'created').catch(() => {});
    return saved;
  }

  async findByTenant(tenantId: string): Promise<Contract[]> {
    return this.contractRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async findAll(): Promise<Contract[]> {
    return this.contractRepo.find({
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  /**
   * Find a contract by id, scoped to a tenant.
   * Pass `tenantId = null` to perform a cross-tenant lookup — reserved for
   * super_admin endpoints and system-level callers (e.g. signatures module).
   * Every regular caller MUST pass the authenticated user's tenantId.
   */
  async findById(id: string, tenantId: string | null): Promise<Contract> {
    // When tenantId is provided (regular callers), enforce tenant guard on
    // the joined creator so an orphan created_by cross-tenant can't leak.
    // super_admin callers pass null → join without guard (intentional).
    const qb = this.contractRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.tenant', 'tenant');
    if (tenantId !== null) {
      qb.leftJoinAndSelect('c.creator', 'creator', 'creator.tenant_id = c.tenant_id')
        .where('c.id = :id', { id })
        .andWhere('c.tenantId = :tenantId', { tenantId });
    } else {
      qb.leftJoinAndSelect('c.creator', 'creator')
        .where('c.id = :id', { id });
    }
    const contract = await qb.getOne();
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    return contract;
  }

  async update(id: string, dto: Partial<{
    title: string;
    description: string;
    content: string;
    fileUrl: string;
    effectiveDate: string;
    expirationDate: string;
  }>, userId: string): Promise<Contract> {
    // update/remove/sendForSignature endpoints are super_admin-only; explicit
    // cross-tenant lookup is intentional (null sentinel).
    const contract = await this.findById(id, null);
    if (contract.status !== 'draft') {
      throw new BadRequestException('Solo se pueden editar contratos en estado borrador');
    }
    if (dto.title) contract.title = dto.title;
    if (dto.description !== undefined) contract.description = dto.description;
    if (dto.content !== undefined) contract.content = dto.content;
    if (dto.fileUrl !== undefined) contract.fileUrl = dto.fileUrl;
    if (dto.effectiveDate) contract.effectiveDate = new Date(dto.effectiveDate);
    if (dto.expirationDate) contract.expirationDate = new Date(dto.expirationDate);
    await this.auditService.log(contract.tenantId, userId, 'contract.updated', 'contract', id).catch(() => {});
    const saved = await this.contractRepo.save(contract);
    this.notifyAdminOnContractChange(id, 'updated').catch(() => {});
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const contract = await this.findById(id, null); // super_admin-only
    if (contract.status !== 'draft') {
      throw new BadRequestException('Solo se pueden eliminar contratos en estado borrador');
    }
    await this.auditService.log(contract.tenantId, userId, 'contract.deleted', 'contract', id, { title: contract.title }).catch(() => {});
    this.notifyAdminOnContractChange(id, 'deleted').catch(() => {});
    await this.contractRepo.remove(contract);
  }

  async sendForSignature(id: string, userId: string): Promise<Contract> {
    const contract = await this.findById(id, null); // super_admin-only
    if (contract.status !== 'draft') {
      throw new BadRequestException('Solo se pueden enviar a firma contratos en estado borrador');
    }
    if (!contract.content && !contract.fileUrl) {
      throw new BadRequestException('El contrato debe tener contenido o un archivo adjunto antes de enviarse a firma');
    }

    // ─── Reglas de negocio para envío a firma ────────────────────────

    // 1. La organización debe tener un plan (suscripción activa)
    const sub = await this.tenantRepo.manager.getRepository('subscriptions').findOne({
      where: { tenantId: contract.tenantId, status: 'active' },
      relations: ['plan'],
    });
    if (!sub || !(sub as any).plan) {
      throw new BadRequestException('La organización debe tener un plan activo antes de enviar contratos a firma. Asigne una suscripción primero.');
    }

    // 2. La organización debe tener dirección comercial
    const tenant = await this.tenantRepo.findOne({ where: { id: contract.tenantId } });
    if (!tenant) throw new BadRequestException('Organización no encontrada');
    if (!tenant.commercialAddress || !tenant.commercialAddress.trim()) {
      throw new BadRequestException('La organización debe tener una dirección comercial ingresada antes de enviar contratos a firma. Actualice los datos de la organización.');
    }

    // 3. El título debe seguir el formato: "Contrato [Tipo] — [Organización]"
    const typeLabels: Record<string, string> = {
      service_agreement: 'Prestación de Servicios',
      dpa: 'Procesamiento de Datos (DPA)',
      terms_conditions: 'Términos y Condiciones',
      privacy_policy: 'Política de Privacidad',
      sla: 'Nivel de Servicio (SLA)',
      nda: 'Confidencialidad (NDA)',
      amendment: 'Enmienda',
    };
    const expectedTitle = `Contrato ${typeLabels[contract.type] || contract.type} — ${tenant.name}`;
    if (contract.title !== expectedTitle) {
      contract.title = expectedTitle;
    }

    // ─── Fin validaciones ────────────────────────────────────────────

    contract.status = 'pending_signature';
    // Log to status history
    const history = Array.isArray(contract.statusHistory) ? [...contract.statusHistory] : [];
    history.push({ status: 'pending_signature', date: new Date().toISOString(), userId });
    contract.statusHistory = history;
    await this.contractRepo.save(contract);
    if (tenant) {
      const admins = await this.userRepo.find({ where: { tenantId: contract.tenantId, role: 'tenant_admin', isActive: true }, select: ['id', 'email', 'firstName'] });
      for (const admin of admins) {
        await this.emailService.sendContractForSignature(admin.email, admin.firstName, contract.title, contract.type, tenant.name).catch(() => {});
      }
    }

    await this.auditService.log(contract.tenantId, userId, 'contract.sent_for_signature', 'contract', id, { title: contract.title }).catch(() => {});
    this.notifyAdminOnContractChange(id, 'sent').catch(() => {});
    return contract;
  }

  /** Create all base contracts with template content for a tenant */
  async createAllBaseContracts(tenantId: string, createdBy: string): Promise<{ created: number; contracts: Contract[] }> {
    const templates = this.getDefaultTemplates();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const created: Contract[] = [];

    for (const tpl of templates) {
      // Skip if this type already exists for the tenant
      const exists = await this.contractRepo.findOne({ where: { tenantId, type: tpl.type } });
      if (exists) continue;

      // Replace placeholders in content
      let content = tpl.content;
      if (tenant) {
        content = content
          .replace(/\{\{tenantName\}\}/g, tenant.name || '')
          .replace(/\{\{tenantRut\}\}/g, tenant.rut || 'Por definir')
          .replace(/\{\{tenantAddress\}\}/g, (tenant as any).commercialAddress || 'Por definir')
          .replace(/\{\{effectiveDate\}\}/g, new Date().toLocaleDateString('es-CL'))
          .replace(/\{\{planName\}\}/g, tenant.plan || 'starter')
          .replace(/\{\{maxEmployees\}\}/g, String(tenant.maxEmployees || 50));
      }

      // Title format: "Contrato [Tipo] — [Organización]"
      const title = `Contrato ${tpl.label} — ${tenant?.name || 'Sin nombre'}`;
      const contract = await this.contractRepo.save(this.contractRepo.create({
        tenantId,
        type: tpl.type,
        title,
        content,
        status: 'draft',
        effectiveDate: new Date(),
        createdBy,
      }));
      created.push(contract);
    }

    await this.auditService.log(tenantId, createdBy, 'contracts.bulk_created', 'contract', null as any, { count: created.length }).catch(() => {});
    return { created: created.length, contracts: created };
  }

  /** Tenant admin rejects a contract — returns to draft with reason */
  async rejectContract(id: string, tenantId: string, userId: string, reason: string): Promise<Contract> {
    const contract = await this.findById(id, tenantId);
    if (contract.status !== 'pending_signature') {
      throw new BadRequestException('Solo se pueden rechazar contratos en estado pendiente de firma');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Debe indicar un motivo de rechazo');
    }

    contract.status = 'draft';
    contract.rejectionReason = reason.trim();
    contract.rejectedAt = new Date();
    contract.rejectedBy = userId;

    // Log to status history
    const history = Array.isArray(contract.statusHistory) ? [...contract.statusHistory] : [];
    history.push({ status: 'rejected', date: new Date().toISOString(), userId, reason: reason.trim() });
    contract.statusHistory = history;

    await this.contractRepo.save(contract);

    // Notify all super_admins about the rejection
    const superAdmins = await this.userRepo.find({ where: { role: 'super_admin', isActive: true }, select: ['id'] });
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['firstName', 'lastName'] });
    const rejectorName = user ? `${user.firstName} ${user.lastName}` : 'Administrador';
    for (const sa of superAdmins) {
      await this.notificationsService.create({
        tenantId: contract.tenantId,
        userId: sa.id,
        type: NotificationType.GENERAL,
        title: `Contrato rechazado: ${contract.title}`,
        message: `${rejectorName} rechazó el contrato. Motivo: ${reason.trim()}`,
      }).catch(() => {});
    }

    await this.auditService.log(contract.tenantId, userId, 'contract.rejected', 'contract', id, { title: contract.title, reason: reason.trim() }).catch(() => {});

    return contract;
  }

  async activateAfterSignature(id: string): Promise<void> {
    // Called from signatures module (system-level) when the last signature is collected.
    const contract = await this.findById(id, null);
    if (contract.status === 'pending_signature') {
      contract.status = 'active';
      // Log to status history
      const history = Array.isArray(contract.statusHistory) ? [...contract.statusHistory] : [];
      history.push({ status: 'active', date: new Date().toISOString() });
      contract.statusHistory = history;
      await this.contractRepo.save(contract);
    }
  }

  /** Get contract content for document hashing (used by signatures module) */
  async getContractContent(id: string): Promise<string> {
    const contract = await this.findById(id, null); // system-level

    return JSON.stringify({
      id: contract.id,
      type: contract.type,
      title: contract.title,
      content: contract.content || '',
      effectiveDate: contract.effectiveDate,
      version: contract.version,
      tenantId: contract.tenantId,
    });
  }

  async getContractName(id: string): Promise<string> {
    const contract = await this.findById(id, null); // system-level
    return contract.title;
  }

  /** Default legal templates with placeholders */
  getDefaultTemplates(): { type: string; label: string; content: string }[] {
    return [
      {
        type: 'service_agreement',
        label: 'Contrato de Prestación de Servicios',
        content: `CONTRATO DE PRESTACIÓN DE SERVICIOS DE SOFTWARE (SaaS)

Entre ASCENDA PERFORMANCE SpA, RUT 78.396.131-8, con domicilio en Fresia 2020, La Pintana, Santiago, representada por su representante legal don Ricardo Morales Olate, RUT 12.121.896-8, en adelante "el Proveedor", y {{tenantName}}, RUT {{tenantRut}}, con domicilio en {{tenantAddress}}, en adelante "el Cliente".

PRIMERO: OBJETO
El Proveedor pondrá a disposición del Cliente la plataforma Eva360 como servicio de software en la nube (SaaS) para la gestión de evaluaciones de desempeño, clima laboral, objetivos y desarrollo del personal.

SEGUNDO: PLAN Y ALCANCE
Plan contratado: {{planName}}
Máximo de usuarios: {{maxEmployees}}
Fecha de inicio: {{effectiveDate}}
Período de facturación: {{billingPeriod}}
Precio: {{price}} {{currency}}/{{billingPeriod}}

TERCERO: OBLIGACIONES DEL PROVEEDOR
a) Mantener la plataforma disponible con un SLA de 99.5% mensual
b) Realizar respaldos diarios de la información
c) Implementar medidas de seguridad según estándares de la industria
d) Proporcionar soporte técnico en horario hábil
e) Notificar con 30 días de anticipación cualquier cambio material al servicio

CUARTO: OBLIGACIONES DEL CLIENTE
a) Pagar oportunamente las tarifas del plan contratado
b) Usar la plataforma conforme a los Términos y Condiciones
c) Mantener la confidencialidad de las credenciales de acceso
d) No intentar acceder a datos de otras organizaciones
e) Designar un administrador responsable del sistema

QUINTO: PROTECCIÓN DE DATOS
Las partes se comprometen a cumplir la Ley 19.628 sobre Protección de Datos Personales. El tratamiento de datos personales se rige por el Acuerdo de Procesamiento de Datos (DPA) adjunto.

SEXTO: PROPIEDAD INTELECTUAL
La plataforma Eva360 y su código fuente son propiedad exclusiva del Proveedor. El Cliente retiene la propiedad de todos los datos ingresados en la plataforma.

SÉPTIMO: VIGENCIA Y TERMINACIÓN
Este contrato tiene vigencia desde la fecha de inicio por períodos renovables automáticamente. Cualquiera de las partes puede terminar el contrato con 30 días de aviso previo por escrito. Al término, el Proveedor exportará los datos del Cliente en formato estándar dentro de 30 días.

OCTAVO: LIMITACIÓN DE RESPONSABILIDAD
La responsabilidad máxima del Proveedor se limita al monto pagado por el Cliente en los últimos 12 meses de servicio.`,
      },
      {
        type: 'dpa',
        label: 'Acuerdo de Procesamiento de Datos (DPA)',
        content: `ACUERDO DE PROCESAMIENTO DE DATOS PERSONALES

En cumplimiento de la Ley 19.628 sobre Protección de la Vida Privada, entre ASCENDA PERFORMANCE SpA, RUT 78.396.131-8 ("Encargado del Tratamiento") y {{tenantName}} ("Responsable del Tratamiento").

1. DATOS TRATADOS
- Datos de identificación: nombre, apellido, RUT, correo electrónico
- Datos laborales: cargo, departamento, fecha de ingreso, jefatura
- Datos de evaluación: puntajes, competencias, objetivos, feedback
- Datos de clima: respuestas a encuestas (pueden ser anónimas)
- Datos de uso: registros de actividad, IP, timestamps

2. FINALIDAD DEL TRATAMIENTO
Exclusivamente para la prestación del servicio de evaluación de desempeño y gestión del talento contratado por el Responsable.

3. MEDIDAS DE SEGURIDAD
- Cifrado en tránsito (TLS 1.2+) y en reposo
- Autenticación JWT con expiración configurable
- Control de acceso basado en roles (RBAC)
- 2FA/MFA opcional con TOTP
- Rate limiting y protección contra fuerza bruta
- Registro de auditoría inmutable
- Respaldos diarios con retención de 30 días

4. SUBPROCESADORES
- Render.com (hosting de API)
- Netlify (hosting de frontend)
- PostgreSQL (base de datos)
- Resend (correo transaccional)
- Cloudinary (almacenamiento de archivos)
- Anthropic (análisis de IA, solo si la funcionalidad está habilitada)

5. DERECHOS DE LOS TITULARES
El Responsable es el punto de contacto para ejercicio de derechos ARCO. El Encargado colaborará en el cumplimiento dentro de 15 días hábiles.

6. RETENCIÓN Y ELIMINACIÓN
Los datos se conservan mientras el contrato esté vigente. Al término, el Encargado eliminará todos los datos dentro de 60 días, previa exportación si el Responsable lo solicita.

7. NOTIFICACIÓN DE INCIDENTES
El Encargado notificará al Responsable cualquier brecha de seguridad dentro de 72 horas de su detección.`,
      },
      {
        type: 'terms_conditions',
        label: 'Términos y Condiciones de Uso',
        content: `TÉRMINOS Y CONDICIONES DE USO — EVA360

1. ACEPTACIÓN
Al acceder y utilizar Eva360, usted acepta estos términos en nombre de su organización ({{tenantName}}).

2. USO ACEPTABLE
- Usar la plataforma solo para fines de gestión de desempeño y talento
- No compartir credenciales de acceso
- No intentar acceder a datos de otras organizaciones
- No realizar ingeniería inversa del software
- No usar la plataforma para fines ilegales o discriminatorios

3. DISPONIBILIDAD
El servicio está disponible 24/7 con un objetivo de disponibilidad del 99.5% mensual. Las ventanas de mantenimiento programado se notificarán con 48 horas de anticipación.

4. PROPIEDAD INTELECTUAL
Eva360, su diseño, código y documentación son propiedad de ASCENDA PERFORMANCE SpA. Los datos ingresados por los usuarios son propiedad de la organización cliente.

5. MODIFICACIONES
ASCENDA PERFORMANCE SpA se reserva el derecho de modificar estos términos con 30 días de aviso previo. El uso continuado después de la notificación constituye aceptación.`,
      },
      {
        type: 'privacy_policy',
        label: 'Política de Privacidad',
        content: `POLÍTICA DE PRIVACIDAD — EVA360

1. DATOS QUE RECOLECTAMOS
- Datos de registro: nombre, correo, RUT, cargo, departamento
- Datos de evaluación: respuestas, puntajes, competencias, objetivos
- Datos de uso: páginas visitadas, acciones realizadas, timestamps, IP
- Datos de clima: respuestas a encuestas (pueden ser anónimas según configuración)

2. CÓMO USAMOS LOS DATOS
- Proveer el servicio de evaluación de desempeño
- Generar reportes y análisis para la organización
- Mejorar la plataforma y la experiencia del usuario
- Enviar notificaciones del sistema (evaluaciones pendientes, etc.)

3. ANÁLISIS CON INTELIGENCIA ARTIFICIAL
Si la funcionalidad de IA está habilitada, los datos de evaluación pueden ser procesados por Anthropic (Claude) para generar resúmenes, detectar sesgos y sugerir acciones de desarrollo. Los datos se envían de forma anonimizada y no se almacenan en servidores de terceros más allá del procesamiento inmediato.

4. DERECHOS DEL TITULAR
Usted tiene derecho a acceder, rectificar, cancelar y oponerse al tratamiento de sus datos (derechos ARCO). Contacte a su administrador de RRHH o a soporte@ascenda.cl.

5. RETENCIÓN
Los datos se conservan mientras la suscripción esté activa. Al terminar el servicio, se eliminan dentro de 60 días.`,
      },
      {
        type: 'sla',
        label: 'Acuerdo de Nivel de Servicio (SLA)',
        content: `ACUERDO DE NIVEL DE SERVICIO (SLA)

1. DISPONIBILIDAD: 99.5% mensual (excluyendo mantenimiento programado)
2. TIEMPO DE RESPUESTA SOPORTE: Crítico 4h, Alto 8h, Normal 24h, Bajo 48h
3. RPO (Recovery Point Objective): 24 horas (respaldos diarios)
4. RTO (Recovery Time Objective): 4 horas
5. COMPENSACIÓN: Si la disponibilidad cae bajo 99.5%, se aplica crédito proporcional al tiempo de inactividad sobre la factura del mes siguiente.
6. EXCLUSIONES: Fuerza mayor, mantenimiento programado notificado con 48h, problemas de red del cliente.`,
      },
      {
        type: 'nda',
        label: 'Acuerdo de Confidencialidad (NDA)',
        content: `ACUERDO DE CONFIDENCIALIDAD

Las partes acuerdan mantener estricta confidencialidad sobre toda información no pública compartida en el contexto de la prestación del servicio, incluyendo: datos de evaluación de personal, estrategias organizacionales, información financiera, y cualquier dato técnico de la plataforma.

Vigencia: 2 años desde la terminación del contrato de servicio.
Excepciones: información pública, obtenida independientemente, o requerida por autoridad competente.`,
      },
    ];
  }

  // ─── PDF Generation ───────────────────────────────────────────────────

  async generatePdf(contractId: string, tenantId: string | null): Promise<Buffer> {
    const contract = await this.findById(contractId, tenantId);

    // Dynamic import jsPDF
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const maxW = pageW - margin * 2;
    let y = 20;

    // Header
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Eva360 by ASCENDA PERFORMANCE SpA — Documento contractual', margin, 10);
    doc.setDrawColor(201, 147, 58);
    doc.setLineWidth(0.5);
    doc.line(margin, 13, pageW - margin, 13);

    // Title
    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.setFont('helvetica', 'bold');
    doc.text(contract.title || 'Contrato', margin, y);
    y += 8;

    // Status + dates
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    const statusLabels: Record<string, string> = {
      draft: 'Borrador', pending_signature: 'Pendiente de firma', active: 'Activo', expired: 'Expirado',
    };
    doc.text(`Estado: ${statusLabels[contract.status] || contract.status}`, margin, y);
    if (contract.effectiveDate) doc.text(`Vigencia: ${new Date(contract.effectiveDate).toLocaleDateString('es-CL')}`, margin + 60, y);
    y += 6;
    if (contract.tenant?.name) {
      doc.text(`Organización: ${contract.tenant.name}`, margin, y);
      y += 6;
    }
    y += 4;

    // Content
    doc.setFontSize(10);
    doc.setTextColor(30);
    const content = (contract.content || contract.description || 'Sin contenido').replace(/<[^>]*>/g, ''); // Strip HTML
    const lines = doc.splitTextToSize(content, maxW);
    for (const line of lines) {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += 5;
    }

    // Footer
    y = doc.internal.pageSize.getHeight() - 10;
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360 by ASCENDA PERFORMANCE SpA`, margin, y);

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Contract Queries (admin → super_admin) ──────────────────────────

  async submitContractQuery(
    contractId: string, tenantId: string, userId: string,
    dto: { type: string; message: string },
  ) {
    const contract = await this.contractRepo.findOne({ where: { id: contractId, tenantId }, relations: ['tenant'] });
    if (!contract) throw new NotFoundException('Contrato no encontrado');

    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'firstName', 'lastName', 'email'] });
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Admin';
    const orgName = contract.tenant?.name || tenantId;

    const queryTypes: Record<string, string> = {
      modification: 'Solicitud de modificación',
      question: 'Consulta',
      renewal: 'Solicitud de renovación',
      cancellation: 'Solicitud de cancelación',
    };

    // Notify ALL super_admins
    const superAdmins = await this.userRepo.find({ where: { role: 'super_admin', isActive: true }, select: ['id'] });
    for (const sa of superAdmins) {
      await this.notificationsService.create({
        tenantId,
        userId: sa.id,
        type: NotificationType.GENERAL,
        title: `${queryTypes[dto.type] || 'Consulta'} de contrato — ${orgName}`,
        message: `${userName} (${orgName}) ha enviado una ${(queryTypes[dto.type] || 'consulta').toLowerCase()} sobre el contrato "${contract.title}": ${dto.message}`,
        metadata: { contractId, queryType: dto.type, fromUserId: userId, fromUserEmail: user?.email },
      }).catch(() => {});
    }

    this.auditService.log(tenantId, userId, 'contract.query_submitted', 'contract', contractId, {
      type: dto.type, message: dto.message, contractTitle: contract.title,
    }).catch(() => {});

    return { sent: true, message: 'Consulta enviada al administrador del sistema.' };
  }

  async getPendingQueries() {
    // Return recent contract-related notifications for super_admins
    // This uses the notification system — queries show up as notifications
    return { message: 'Las consultas de contratos se muestran como notificaciones del sistema.' };
  }

  // ─── Notifications: SA → Admin on contract changes ───────────────────

  async notifyAdminOnContractChange(contractId: string, action: string) {
    const contract = await this.contractRepo.findOne({ where: { id: contractId }, relations: ['tenant'] });
    if (!contract) return;

    const actionLabels: Record<string, string> = {
      created: 'creado', updated: 'actualizado', sent: 'enviado a firma', deleted: 'eliminado',
    };

    // Notify all tenant_admins of the organization
    const admins = await this.userRepo.find({
      where: { tenantId: contract.tenantId, role: 'tenant_admin', isActive: true },
      select: ['id'],
    });

    for (const admin of admins) {
      await this.notificationsService.create({
        tenantId: contract.tenantId,
        userId: admin.id,
        type: NotificationType.GENERAL,
        title: `Contrato ${actionLabels[action] || action}`,
        message: `El contrato "${contract.title}" ha sido ${actionLabels[action] || action} por el administrador del sistema.`,
        metadata: { contractId, action },
      }).catch(() => {});
    }
  }
}
