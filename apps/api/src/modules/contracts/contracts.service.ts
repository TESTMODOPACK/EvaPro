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
import { ASCENDA_COMPANY } from './ascenda-company.config';

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

    // 2.b. La organización debe tener representante legal (nombre + RUT).
    //      Sin esto, el contrato queda firmado sin identificar al firmante
    //      por el Cliente — débil legalmente. Los placeholders
    //      {{legalRepName}}/{{legalRepRut}} del encabezado ENTRE LAS
    //      PARTES quedarían "Por definir" y el contrato no es válido.
    if (!(tenant as any).legalRepName || !String((tenant as any).legalRepName).trim()) {
      throw new BadRequestException('La organización debe tener el nombre del representante legal ingresado antes de enviar contratos a firma. Actualice los datos de la organización.');
    }
    if (!(tenant as any).legalRepRut || !String((tenant as any).legalRepRut).trim()) {
      throw new BadRequestException('La organización debe tener el RUT del representante legal ingresado antes de enviar contratos a firma. Actualice los datos de la organización.');
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

  /**
   * Rellena un template con los datos del tenant + proveedor (Ascenda) +
   * plan/suscripción activa. Antes solo reemplazaba 6 placeholders; ahora
   * incluye el encabezado estándar ENTRE LAS PARTES usado por los 6
   * contratos, los datos legales del Proveedor (leídos de env vars o
   * defaults de ASCENDA_COMPANY), y los datos económicos del plan para
   * que el cliente firme un documento con precio/período concretos, no
   * placeholders.
   *
   * Si el tenant no tiene suscripción, los campos de plan quedan
   * "Por definir" — el contrato se puede generar pero tiene que
   * completarse antes de enviar a firma (el método sendForSignature
   * valida plan activo).
   */
  private async fillTemplate(content: string, tenant: Tenant | null): Promise<string> {
    // Resolver datos del plan si hay suscripción activa.
    let planName: string = 'Por definir';
    let priceDisplay: string = 'Por definir';
    let billingPeriodDisplay: string = 'mensual';
    let currencyCode: string = 'UF';
    let maxEmployees: string = 'Por definir';

    if (tenant) {
      try {
        const sub = await this.tenantRepo.manager.getRepository('subscriptions').findOne({
          where: { tenantId: tenant.id, status: 'active' },
          relations: ['plan'],
        });
        const plan = (sub as any)?.plan;
        if (plan) {
          planName = plan.name || 'Plan';
          currencyCode = plan.currency || 'UF';
          maxEmployees = String(plan.maxEmployees || 50);
          // Elegir precio según el período de facturación.
          const bp = (sub as any)?.billingPeriod || 'monthly';
          const periodMap: Record<string, { price: any; label: string }> = {
            monthly: { price: plan.monthlyPrice, label: 'mensual' },
            quarterly: { price: plan.quarterlyPrice, label: 'trimestral' },
            semiannual: { price: plan.semiannualPrice, label: 'semestral' },
            annual: { price: plan.yearlyPrice, label: 'anual' },
          };
          const selected = periodMap[bp] || periodMap.monthly;
          priceDisplay = selected.price ? String(selected.price) : 'Por definir';
          billingPeriodDisplay = selected.label;
        } else if (tenant.plan) {
          // Fallback: tenant tiene el nombre del plan pero no hay
          // suscripción activa hidratada. Mejor que "Por definir" para
          // el nombre, pero precio sigue pendiente.
          planName = tenant.plan;
          maxEmployees = String(tenant.maxEmployees || 50);
        }
      } catch {
        // findOne puede fallar si no existe la tabla en dev/test — seguir.
      }
    }

    // Datos del Proveedor (Ascenda) — env vars o defaults.
    const ascenda = ASCENDA_COMPANY;

    let out = content;

    // Tenant placeholders
    out = out
      .replace(/\{\{tenantName\}\}/g, tenant?.name || 'Sin nombre')
      .replace(/\{\{tenantRut\}\}/g, tenant?.rut || 'Por definir')
      .replace(/\{\{tenantAddress\}\}/g, (tenant as any)?.commercialAddress || 'Por definir')
      .replace(/\{\{legalRepName\}\}/g, (tenant as any)?.legalRepName || 'Por definir')
      .replace(/\{\{legalRepRut\}\}/g, (tenant as any)?.legalRepRut || 'Por definir')
      .replace(/\{\{effectiveDate\}\}/g, new Date().toLocaleDateString('es-CL'))
      // Plan placeholders
      .replace(/\{\{planName\}\}/g, planName)
      .replace(/\{\{maxEmployees\}\}/g, maxEmployees)
      .replace(/\{\{billingPeriod\}\}/g, billingPeriodDisplay)
      .replace(/\{\{price\}\}/g, priceDisplay)
      .replace(/\{\{currency\}\}/g, currencyCode)
      // Ascenda (Proveedor) placeholders
      .replace(/\{\{ascendaName\}\}/g, ascenda.legalName)
      .replace(/\{\{ascendaRut\}\}/g, ascenda.rut)
      .replace(/\{\{ascendaAddress\}\}/g, ascenda.address)
      .replace(/\{\{ascendaLegalRepName\}\}/g, ascenda.legalRepName)
      .replace(/\{\{ascendaLegalRepRut\}\}/g, ascenda.legalRepRut)
      .replace(/\{\{ascendaSupportEmail\}\}/g, ascenda.supportEmail)
      .replace(/\{\{productName\}\}/g, ascenda.productName)
      .replace(/\{\{productDomain\}\}/g, ascenda.productDomain);

    return out;
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

      // Rellenar placeholders vía método centralizado.
      const content = await this.fillTemplate(tpl.content, tenant);

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

  /**
   * Plantillas legales con placeholders. Todas las plantillas abren con
   * el mismo encabezado "ENTRE LAS PARTES" para identificar claramente al
   * Proveedor y al Cliente (con representantes legales). Los placeholders
   * `{{ascenda*}}` se resuelven desde ASCENDA_COMPANY (env vars); los
   * `{{tenant*}}/{{legalRep*}}` se resuelven desde la organización cliente.
   *
   * Ver fillTemplate() para la lista completa de placeholders soportados.
   */
  getDefaultTemplates(): { type: string; label: string; content: string }[] {
    // Encabezado compartido por los 6 tipos de contrato. Identifica
    // partes y representantes legales con RUT. El placeholder
    // {{effectiveDate}} se completa con la fecha de creación.
    const standardHeader = `ENTRE LAS PARTES

PROVEEDOR ("Ascenda"):
  Razón social:        {{ascendaName}}
  RUT:                 {{ascendaRut}}
  Domicilio:           {{ascendaAddress}}
  Representante legal: {{ascendaLegalRepName}}, RUT {{ascendaLegalRepRut}}
  Contacto:            {{ascendaSupportEmail}}

CLIENTE ("{{tenantName}}"):
  Razón social:        {{tenantName}}
  RUT:                 {{tenantRut}}
  Domicilio:           {{tenantAddress}}
  Representante legal: {{legalRepName}}, RUT {{legalRepRut}}

Fecha de inicio: {{effectiveDate}}

──────────────────────────────────────────────────────────────────────
`;

    return [
      {
        type: 'service_agreement',
        label: 'Contrato de Prestación de Servicios',
        content: `CONTRATO DE PRESTACIÓN DE SERVICIOS DE SOFTWARE (SaaS)

${standardHeader}

PRIMERO: OBJETO
El Proveedor pondrá a disposición del Cliente la plataforma {{productName}}, accesible en {{productDomain}}, como servicio de software en la nube (SaaS) para la gestión de evaluaciones de desempeño, clima laboral, objetivos y desarrollo del personal.

SEGUNDO: PLAN Y ALCANCE
  Plan contratado:        {{planName}}
  Máximo de usuarios:     {{maxEmployees}}
  Período de facturación: {{billingPeriod}}
  Precio:                 {{price}} {{currency}} / {{billingPeriod}}

El detalle de funcionalidades del plan puede consultarse en cualquier momento desde la sección "Mi Suscripción" de la plataforma.

TERCERO: OBLIGACIONES DEL PROVEEDOR
a) Mantener la plataforma disponible con un SLA de 99.5% mensual (ver SLA adjunto)
b) Realizar respaldos diarios de la información del Cliente (ver cláusula QUINTO)
c) Implementar medidas de seguridad según estándares de la industria (cláusula CUARTO)
d) Proporcionar soporte técnico en horario hábil (lunes a viernes, 9:00–18:00 hora Chile)
e) Notificar con 30 días de anticipación cualquier cambio material al servicio
f) Garantizar portabilidad de datos del Cliente en formatos estándar (CSV, Excel, PDF)
g) Cumplir con la Ley 19.628 sobre Protección de Datos Personales

CUARTO: INFRAESTRUCTURA Y PLATAFORMA TECNOLÓGICA
La plataforma {{productName}} se ejecuta sobre la siguiente infraestructura y stack tecnológico:

a) Infraestructura: servidor virtual privado (VPS) en Hostinger, con aislamiento de red y recursos dedicados.
b) Orquestación: Docker Compose administra los componentes (base de datos, API, frontend, reverse proxy Nginx).
c) Stack de aplicación: NestJS 11 (API), Next.js 14 (frontend), PostgreSQL 16 (base de datos relacional).
d) Dominio y cifrado: {{productDomain}} con certificado TLS válido (Let's Encrypt) renovable automáticamente.
e) Arquitectura multi-tenant: aislamiento lógico de datos por tenant_id. Ninguna organización puede acceder a datos de otra.
f) Autenticación: JWT con expiración configurable, 2FA/TOTP opcional, SSO OIDC para clientes enterprise.
g) Registro de auditoría inmutable de todas las operaciones críticas.

QUINTO: POLÍTICA DE RESPALDOS Y CONTINUIDAD OPERATIVA
El Proveedor ejecuta respaldos automáticos de la base de datos con las siguientes características:

a) Frecuencia: respaldo completo diario a las 03:00 AM hora Chile (GMT-3 / GMT-4).
b) Formato: pg_dump formato custom con compresión máxima.
c) Retención local: 30 días rotativos en el mismo servidor.
d) Retención off-site: almacenamiento cifrado en proveedor independiente (Cloudflare R2, Backblaze B2 o similar).
e) Verificación: test de restore a base de datos temporal mensualmente.
f) RPO (Recovery Point Objective): máximo 24 horas. En caso de catástrofe, la pérdida de datos no excederá las 24 horas previas al incidente.
g) RTO (Recovery Time Objective): máximo 4 horas. El servicio será restablecido dentro de este plazo.

SEXTO: SERVICIOS DE TERCEROS (SUBPROCESADORES)
Para prestar el servicio, el Proveedor se apoya en los siguientes subprocesadores. Todos los datos compartidos con ellos se tratan conforme a esta cláusula y al DPA adjunto.

a) Hostinger — Infraestructura VPS (Europa / Latinoamérica).
b) Resend — Envío de correo transaccional (notificaciones, invitaciones, recordatorios).
c) Stripe — Procesamiento de pagos con tarjeta (mercados internacionales), cuando aplique.
d) MercadoPago — Procesamiento de pagos (Latinoamérica), cuando aplique.
e) Cloudinary — Almacenamiento de archivos adjuntos (CVs, exports GDPR).
f) Anthropic (Claude) — Análisis con inteligencia artificial para generación de resúmenes, detección de sesgos y sugerencias de desarrollo. Habilitado solo si el Cliente activa la funcionalidad de IA.
g) Cloudflare / Let's Encrypt — CDN y certificados TLS.

El Cliente reconoce que el uso de estos subprocesadores puede implicar transferencia internacional de datos, siempre bajo las salvaguardas contractuales equivalentes a las de este contrato.

SÉPTIMO: OBLIGACIONES DEL CLIENTE
a) Pagar oportunamente las tarifas del plan contratado
b) Usar la plataforma conforme a los Términos y Condiciones de Uso
c) Mantener la confidencialidad de las credenciales de acceso de sus usuarios
d) No intentar acceder a datos de otras organizaciones
e) Designar un administrador responsable del sistema
f) Garantizar que los datos personales ingresados cuenten con el consentimiento de sus titulares
g) Notificar al Proveedor cualquier incidente de seguridad detectado

OCTAVO: PAGOS Y FACTURACIÓN
a) La facturación es MENSUAL y se cobra anticipadamente el primer día de cada mes calendario (o al momento de la contratación si es mitad de mes, con prorrateo proporcional solo del primer cobro).
b) El pago es NO REEMBOLSABLE. Si el Cliente decide terminar el servicio antes del fin del mes ya facturado, el servicio continuará funcionando normalmente hasta el último día del mes pagado. NO habrá reembolso parcial ni prorrateo del período no utilizado.
c) Cancelación: el Cliente debe notificar con al menos 5 días de anticipación al cierre del mes para que la baja sea efectiva ese mes. Si la notificación llega con menos anticipación, la baja se efectúa al cierre del mes siguiente (sujeta al cobro regular de ese mes).
d) Mora: pagos atrasados más de 15 días generan suspensión del servicio hasta la regularización. Mora de 30 días habilita al Proveedor a terminar el contrato sin responsabilidad.
e) Facturas emitidas en formato electrónico válido para el Servicio de Impuestos Internos (SII) de Chile.
f) Renovación automática: el contrato se renueva mensualmente por períodos sucesivos salvo cancelación conforme al literal (c).

NOVENO: PROTECCIÓN DE DATOS PERSONALES
Las partes se comprometen a cumplir la Ley 19.628 sobre Protección de la Vida Privada y sus modificaciones. El tratamiento de datos personales se rige por el Acuerdo de Procesamiento de Datos (DPA) adjunto, que forma parte integral de este contrato.

El Proveedor actúa como Encargado del Tratamiento; el Cliente es el Responsable del Tratamiento y debe garantizar la licitud de la recopilación.

DÉCIMO: PROPIEDAD INTELECTUAL
La plataforma {{productName}}, su código fuente, diseño, documentación y marca son propiedad exclusiva de {{ascendaName}}. El Cliente no adquiere derechos de propiedad intelectual sobre el software.

El Cliente retiene la propiedad exclusiva de todos los datos ingresados en la plataforma por sus usuarios. El Proveedor no usará estos datos para fines distintos a la prestación del servicio.

UNDÉCIMO: VIGENCIA Y TERMINACIÓN
Este contrato tiene vigencia desde la Fecha de Inicio por períodos mensuales renovables automáticamente según la cláusula OCTAVO (f). Al término:

a) El Proveedor exportará todos los datos del Cliente en formato estándar dentro de 30 días calendario.
b) Los datos serán eliminados de los servidores del Proveedor dentro de 60 días posteriores a la exportación.
c) Las cuentas de usuario serán desactivadas en la fecha de término.

DUODÉCIMO: LIMITACIÓN DE RESPONSABILIDAD
La responsabilidad máxima del Proveedor por cualquier reclamo derivado de este contrato se limita al monto total pagado por el Cliente en los últimos 12 meses de servicio.

El Proveedor no será responsable por: (a) daños indirectos, incidentales o consecuentes; (b) pérdida de datos causada por acciones del Cliente; (c) interrupciones causadas por factores externos (internet, infraestructura del Cliente, proveedores de pago, terceros).

DÉCIMO TERCERO: RESOLUCIÓN DE CONTROVERSIAS
Las partes procurarán resolver cualquier controversia de forma directa y amistosa. En caso de no llegar a acuerdo, se someterá a arbitraje conforme al Reglamento del Centro de Arbitraje y Mediación de Santiago.

DÉCIMO CUARTO: DOCUMENTOS INTEGRANTES
Forman parte integral de este contrato:
1. Acuerdo de Procesamiento de Datos (DPA)
2. Términos y Condiciones de Uso
3. Política de Privacidad
4. Acuerdo de Nivel de Servicio (SLA)
5. Acuerdo de Confidencialidad (NDA)

──────────────────────────────────────────────────────────────────────

FIRMAS

POR EL PROVEEDOR — {{ascendaName}}
Firma: _______________________________
Nombre: {{ascendaLegalRepName}}
RUT: {{ascendaLegalRepRut}}
Fecha: _______________________________

POR EL CLIENTE — {{tenantName}}
Firma: _______________________________
Nombre: {{legalRepName}}
RUT: {{legalRepRut}}
Fecha: _______________________________`,
      },
      {
        type: 'dpa',
        label: 'Acuerdo de Procesamiento de Datos (DPA)',
        content: `ACUERDO DE PROCESAMIENTO DE DATOS PERSONALES

${standardHeader}

En cumplimiento de la Ley 19.628 sobre Protección de la Vida Privada de Chile, el Proveedor actúa como "Encargado del Tratamiento" y el Cliente como "Responsable del Tratamiento" de los datos personales procesados en la plataforma {{productName}}.

1. DATOS TRATADOS
- Datos de identificación: nombre, apellido, RUT, correo electrónico
- Datos laborales: cargo, departamento, fecha de ingreso, jefatura
- Datos de evaluación: puntajes, competencias, objetivos, feedback
- Datos demográficos (opcionales para DEI): género, nacionalidad, fecha de nacimiento
- Datos de clima: respuestas a encuestas (pueden ser anónimas)
- Datos de uso: registros de actividad, IP, timestamps

2. FINALIDAD DEL TRATAMIENTO
Exclusivamente para la prestación del servicio de evaluación de desempeño y gestión del talento contratado por el Responsable. El Proveedor NO usará los datos para fines de marketing propio, venta a terceros, ni entrenamiento de modelos de IA propios.

3. MEDIDAS DE SEGURIDAD
- Cifrado en tránsito (TLS 1.2+) y en reposo (AES-256 para campos sensibles como secretos SSO)
- Autenticación JWT con expiración y versionado para revocación
- Control de acceso basado en roles (RBAC)
- 2FA/MFA opcional con TOTP
- Rate limiting y protección contra fuerza bruta
- Registro de auditoría inmutable
- Respaldos diarios con retención 30 días local + off-site cifrado
- Políticas de contraseña configurables por organización (longitud, complejidad, expiración, historial)

4. SUBPROCESADORES
- Hostinger (infraestructura VPS)
- PostgreSQL 16 (base de datos, alojada en el mismo VPS)
- Resend (correo transaccional)
- Stripe, MercadoPago (procesadores de pago, cuando aplique)
- Cloudinary (almacenamiento de archivos)
- Anthropic Claude (análisis de IA, solo si la funcionalidad está habilitada por el Responsable)
- Cloudflare / Let's Encrypt (CDN y certificados TLS)

El Proveedor notificará al Responsable con al menos 15 días de anticipación cualquier cambio de subprocesadores que implique transferencia internacional de datos nueva.

5. DERECHOS DE LOS TITULARES (ARCO)
El Responsable es el punto de contacto principal para el ejercicio de derechos de Acceso, Rectificación, Cancelación y Oposición. El Encargado colaborará técnicamente para dar respuesta dentro de 15 días hábiles, incluyendo:
- Export completo de datos del titular (GDPR Art. 15 / Ley 19.628 Art. 12)
- Anonimización o borrado (GDPR Art. 17 / derecho de cancelación)
- Rectificación de inexactitudes

6. RETENCIÓN Y ELIMINACIÓN
Los datos se conservan mientras el contrato esté vigente. Al término, el Encargado:
- Exportará los datos en formato estándar dentro de 30 días calendario
- Eliminará definitivamente los datos del sistema activo dentro de 60 días calendario posteriores a la exportación
- Los backups aún con datos serán sobrescritos naturalmente en el plazo de retención (máximo 30 días locales + rotación off-site)

7. NOTIFICACIÓN DE INCIDENTES DE SEGURIDAD
El Encargado notificará al Responsable cualquier brecha de seguridad dentro de 72 horas de su detección, incluyendo:
- Naturaleza del incidente
- Categorías y volumen aproximado de datos afectados
- Medidas tomadas y por tomar para mitigar

8. AUDITORÍA
El Responsable puede solicitar una auditoría remota (vía videollamada) de las medidas de seguridad del Encargado una vez al año, con al menos 30 días de aviso previo.

──────────────────────────────────────────────────────────────────────

FIRMAS

POR EL ENCARGADO — {{ascendaName}}
Firma: _______________________________
Nombre: {{ascendaLegalRepName}}
RUT: {{ascendaLegalRepRut}}

POR EL RESPONSABLE — {{tenantName}}
Firma: _______________________________
Nombre: {{legalRepName}}
RUT: {{legalRepRut}}`,
      },
      {
        type: 'terms_conditions',
        label: 'Términos y Condiciones de Uso',
        content: `TÉRMINOS Y CONDICIONES DE USO — {{productName}}

${standardHeader}

1. ACEPTACIÓN
Al acceder y utilizar {{productName}}, el Cliente y sus usuarios aceptan estos términos en nombre de la organización ({{tenantName}}). Los usuarios individuales que acceden a la plataforma actúan en representación de su organización.

2. USO ACEPTABLE
- Usar la plataforma solo para fines de gestión de desempeño y talento
- No compartir credenciales de acceso entre usuarios
- No intentar acceder a datos de otras organizaciones
- No realizar ingeniería inversa del software ni extracción masiva automatizada
- No usar la plataforma para fines ilegales o discriminatorios

3. SUSCRIPCIÓN Y PAGOS
La suscripción a {{productName}} se factura MENSUALMENTE por anticipado. Los pagos NO son reembolsables en caso de cancelación antes del fin del mes pagado: el servicio continúa funcionando hasta el último día del mes facturado. Consultar cláusula OCTAVO del Contrato de Prestación de Servicios para el detalle completo.

4. DISPONIBILIDAD
El servicio está disponible 24/7 con un objetivo de disponibilidad del 99.5% mensual. Las ventanas de mantenimiento programado se notificarán con al menos 48 horas de anticipación.

5. PROPIEDAD INTELECTUAL
{{productName}}, su diseño, código y documentación son propiedad de {{ascendaName}}. Los datos ingresados por los usuarios son propiedad de la organización cliente.

6. RESPONSABILIDAD DEL USUARIO
Cada usuario es responsable de la veracidad de la información que ingresa. El Cliente es responsable de obtener el consentimiento de sus colaboradores para el tratamiento de datos personales.

7. MODIFICACIONES
{{ascendaName}} se reserva el derecho de modificar estos términos con al menos 30 días de aviso previo por correo electrónico al administrador de la organización. El uso continuado después de la notificación constituye aceptación tácita.

8. CONTACTO
Consultas y reclamos: {{ascendaSupportEmail}}

──────────────────────────────────────────────────────────────────────

Aceptación del Cliente:

{{tenantName}}
Representante legal: {{legalRepName}}, RUT {{legalRepRut}}
Firma: _______________________________
Fecha: _______________________________`,
      },
      {
        type: 'privacy_policy',
        label: 'Política de Privacidad',
        content: `POLÍTICA DE PRIVACIDAD — {{productName}}

${standardHeader}

Esta política describe cómo {{ascendaName}} (en adelante "el Proveedor") recolecta, usa y protege los datos personales de los usuarios de la plataforma {{productName}}.

1. DATOS QUE RECOLECTAMOS
- Datos de registro: nombre, correo, RUT, cargo, departamento
- Datos de evaluación: respuestas, puntajes, competencias, objetivos
- Datos de uso: páginas visitadas, acciones realizadas, timestamps, IP
- Datos de clima: respuestas a encuestas (pueden ser anónimas según configuración de la organización)
- Datos demográficos opcionales (género, nacionalidad, etc.) para análisis DEI agregado

2. CÓMO USAMOS LOS DATOS
- Proveer el servicio de evaluación de desempeño contratado
- Generar reportes y análisis para la organización cliente
- Mejorar la plataforma y la experiencia del usuario
- Enviar notificaciones del sistema (evaluaciones pendientes, recordatorios)
- Cumplir obligaciones legales (facturación SII, retención de audit logs)

NO usamos sus datos para: marketing propio, venta a terceros, entrenamiento de IA externa sin anonimización previa.

3. ANÁLISIS CON INTELIGENCIA ARTIFICIAL
Si la funcionalidad de IA está habilitada por su organización, los datos de evaluación pueden ser procesados por Anthropic (Claude) para generar resúmenes, detectar sesgos y sugerir acciones de desarrollo. Los datos se envían anonimizados y no se almacenan en servidores de Anthropic más allá del procesamiento inmediato.

4. DERECHOS DEL TITULAR (ARCO)
Usted tiene derecho a:
- Acceder a sus datos personales almacenados
- Rectificar datos inexactos
- Cancelar/eliminar sus datos (sujeto a obligaciones legales de retención)
- Oponerse al tratamiento para fines distintos a la prestación del servicio

Contacte a su administrador de RRHH (punto de contacto principal) o a {{ascendaSupportEmail}}.

5. RETENCIÓN
Los datos se conservan mientras la suscripción de su organización esté activa. Al terminar el servicio, se eliminan del sistema activo dentro de 60 días calendario posteriores a la exportación.

6. SEGURIDAD
El Proveedor implementa medidas técnicas y organizacionales razonables para proteger los datos: cifrado TLS, autenticación JWT, 2FA opcional, respaldos diarios, auditoría inmutable. Ver cláusula QUINTO del Contrato de Prestación de Servicios para el detalle.

7. COOKIES Y ANALÍTICA
La plataforma usa cookies técnicas necesarias para el funcionamiento (sesión, preferencias). No se utilizan cookies de terceros con fines publicitarios.

8. CONTACTO
Para cualquier consulta sobre esta política: {{ascendaSupportEmail}}

──────────────────────────────────────────────────────────────────────

Aceptación del Cliente:

{{tenantName}}
Representante legal: {{legalRepName}}, RUT {{legalRepRut}}
Firma: _______________________________
Fecha: _______________________________`,
      },
      {
        type: 'sla',
        label: 'Acuerdo de Nivel de Servicio (SLA)',
        content: `ACUERDO DE NIVEL DE SERVICIO (SLA) — {{productName}}

${standardHeader}

1. DISPONIBILIDAD DEL SERVICIO
Compromiso: 99.5% mensual (excluyendo mantenimiento programado).
  - Downtime tolerado mensual: máximo 3h 39m (efectivo).

2. TIEMPO DE RESPUESTA DE SOPORTE
  - Crítico (caído total, bloqueo masivo):    respuesta dentro de 4 horas hábiles
  - Alto (funcionalidad importante rota):     respuesta dentro de 8 horas hábiles
  - Normal (funcionalidad secundaria):        respuesta dentro de 24 horas hábiles
  - Bajo (mejora o consulta):                 respuesta dentro de 48 horas hábiles

Horario hábil: lunes a viernes, 9:00–18:00 hora Chile.

3. OBJETIVOS DE RECUPERACIÓN
  - RPO (Recovery Point Objective): 24 horas. Frente a un desastre, la pérdida máxima de datos será la de las 24 horas previas.
  - RTO (Recovery Time Objective): 4 horas. El servicio será restablecido en ese plazo.

4. RESPALDOS
  - Frecuencia: diaria (03:00 AM hora Chile)
  - Retención local: 30 días rotativos
  - Retención off-site: cifrado en storage independiente, indefinida con rotación según política operativa
  - Verificación: restore-test mensual a base de datos temporal (no afecta producción)

5. COMPENSACIÓN POR INCUMPLIMIENTO DE DISPONIBILIDAD
Si en un mes calendario la disponibilidad cae bajo el 99.5% comprometido, el Cliente tiene derecho a un crédito proporcional al tiempo de inactividad sobre la factura del mes siguiente, calculado como:

  Crédito = (horas de downtime efectivo / horas totales del mes) × factura mensual base

El crédito no se aplica automáticamente — debe ser solicitado por el Cliente dentro de 30 días calendario del incidente, con evidencia del downtime (screenshots, timestamps, tickets abiertos).

6. EXCLUSIONES
No cuenta como downtime para efectos de este SLA:
a) Mantenimiento programado notificado con al menos 48 horas de anticipación
b) Fuerza mayor: desastres naturales, interrupciones de infraestructura de terceros (Hostinger, Cloudflare, proveedores de internet), ataques de denegación de servicio masivos fuera del control del Proveedor
c) Problemas de red o infraestructura del Cliente
d) Uso del servicio contrario a los Términos y Condiciones
e) Períodos en que el Cliente decidió no usar el servicio (ver cláusula OCTAVO del Contrato: no hay reembolso por no-uso)

──────────────────────────────────────────────────────────────────────

Aceptación:

POR EL PROVEEDOR — {{ascendaName}}
Firma: _______________________________
Nombre: {{ascendaLegalRepName}}
RUT: {{ascendaLegalRepRut}}

POR EL CLIENTE — {{tenantName}}
Firma: _______________________________
Nombre: {{legalRepName}}
RUT: {{legalRepRut}}`,
      },
      {
        type: 'nda',
        label: 'Acuerdo de Confidencialidad (NDA)',
        content: `ACUERDO DE CONFIDENCIALIDAD

${standardHeader}

Las partes acuerdan mantener estricta confidencialidad sobre toda información no pública compartida en el contexto de la prestación del servicio, incluyendo pero no limitada a:

- Datos de evaluación de personal (puntajes, feedback, comentarios)
- Estrategias organizacionales y de gestión del talento
- Información financiera de la relación comercial (precios, descuentos, términos)
- Datos técnicos y operacionales de la plataforma (arquitectura, flujos internos, credenciales)
- Datos de clima laboral y respuestas de encuestas

1. EXCEPCIONES
No se considera información confidencial la que:
a) Sea de dominio público sin culpa de la parte receptora
b) Haya sido obtenida independientemente por la parte receptora antes de este acuerdo
c) Deba ser divulgada por obligación legal, orden judicial o requerimiento de autoridad competente (en tal caso, la parte obligada notificará a la otra antes de divulgar, cuando sea legalmente posible)

2. MEDIDAS DE PROTECCIÓN
Ambas partes aplicarán a la información confidencial las mismas medidas de protección que a su propia información confidencial, nunca inferiores a las razonablemente esperables.

3. VIGENCIA
2 años contados desde la terminación del Contrato de Prestación de Servicios. Para información clasificada como "secreto comercial", la confidencialidad es indefinida.

4. INCUMPLIMIENTO
El incumplimiento de este acuerdo habilita a la parte afectada a solicitar indemnización por los daños reales causados.

──────────────────────────────────────────────────────────────────────

FIRMAS

POR EL PROVEEDOR — {{ascendaName}}
Firma: _______________________________
Nombre: {{ascendaLegalRepName}}
RUT: {{ascendaLegalRepRut}}

POR EL CLIENTE — {{tenantName}}
Firma: _______________________________
Nombre: {{legalRepName}}
RUT: {{legalRepRut}}`,
      },
    ];
  }

  // ─── PDF Generation ───────────────────────────────────────────────────
  //
  // Generador profesional de PDFs de contratos (v2 — Ascenda branded).
  //
  // Features:
  //   - Header/footer en TODAS las páginas
  //   - Logo Ascenda dibujado con primitivas (5 barras ascendentes + ápice)
  //   - Numeración "Página X de Y"
  //   - Typography jerárquica (H1, secciones, body)
  //   - Sanitización de Unicode → Latin-1 (jsPDF con helvetica default
  //     renderiza ─, —, –, etc. como "%" si no se normalizan)
  //   - Parser que detecta: título grande, secciones ("PRIMERO:", "1."),
  //     separadores horizontales (─, ---), y el resto como body
  //
  // La única lib es jsPDF (ya dependencia existente). Sin imágenes
  // externas para mantener el PDF ligero (~10-30 KB) y reproducible
  // determinísticamente. El logo se dibuja con rectángulos + círculo
  // + línea punteada, coincidiendo con el logo oficial de Ascenda.

  async generatePdf(contractId: string, tenantId: string | null): Promise<Buffer> {
    const contract = await this.findById(contractId, tenantId);

    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // Layout
    const margin = 18;
    const contentW = pageW - margin * 2;
    const headerBottom = 22;    // bajo esta Y empieza el contenido
    const footerTop = pageH - 18; // sobre esta Y termina el contenido

    // Ascenda brand palette (RGB tuples)
    type RGB = [number, number, number];
    const GOLD: RGB       = [201, 147, 58];   // dorado principal
    const GOLD_LIGHT: RGB = [232, 201, 122];
    const GOLD_PALE: RGB  = [245, 228, 168];
    const INK: RGB        = [26, 22, 20];     // casi negro
    const INK_SOFT: RGB   = [69, 64, 60];
    const INK_MUTE: RGB   = [122, 116, 108];
    const LINE: RGB       = [220, 215, 205];
    const BG_SOFT: RGB    = [252, 247, 235];  // crema para badges

    // jsPDF no permite spread en setFillColor, hacemos helpers tipados.
    const setFill  = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
    const setDraw  = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
    const setText  = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

    // ── Sanitize Unicode → Latin-1 ──────────────────────────────────────
    // jsPDF helvetica default no soporta chars fuera de Latin-1. Box-drawing
    // como ─ (U+2500) y em-dash — (U+2014) se renderizan como "%". Las
    // letras acentuadas (á,é,í,ó,ú,ñ,Ñ,¿,¡) SÍ están en Latin-1 y funcionan.
    const sanitize = (s: string): string => s
      .replace(/[\u2014\u2013]/g, '-')             // em-dash, en-dash → -
      .replace(/[\u201C\u201D\u201F]/g, '"')       // smart double quotes
      .replace(/[\u2018\u2019\u201B]/g, "'")       // smart single quotes
      .replace(/\u2026/g, '...')                   // …
      .replace(/\u2022/g, '*')                     // •
      .replace(/\u2192/g, '->')                    // →
      .replace(/[\u2500-\u257F]/g, '-')            // box-drawing
      .replace(/[\u2000-\u200F\u202F\u205F]/g, ' '); // various Unicode whitespace

    // ── Logo Ascenda: 5 barras ascendentes + ápice ──────────────────────
    const drawLogo = (x: number, y: number, w: number, h: number) => {
      const slots = 5;
      const barW  = w / (slots * 1.35);
      const gap   = barW * 0.35;
      const baseY = y + h;
      // heights = proporción de alto; opacities emuladas mixando dorado ↔ dorado claro
      const heights    = [0.28, 0.42, 0.62, 0.80, 1.00];
      const mixWithGold = [0.35, 0.55, 0.72, 0.88, 1.00];
      for (let i = 0; i < slots; i++) {
        const bh = h * heights[i];
        const bx = x + i * (barW + gap);
        const by = baseY - bh;
        const mix = mixWithGold[i];
        const r = Math.round(GOLD_LIGHT[0] * (1 - mix) + GOLD[0] * mix);
        const g = Math.round(GOLD_LIGHT[1] * (1 - mix) + GOLD[1] * mix);
        const b = Math.round(GOLD_LIGHT[2] * (1 - mix) + GOLD[2] * mix);
        doc.setFillColor(r, g, b);
        doc.roundedRect(bx, by, barW, bh, 0.25, 0.25, 'F');
      }
      // Punto luminoso sobre la última barra
      const apexX = x + 4 * (barW + gap) + barW / 2;
      const apexY = baseY - h;
      setFill(GOLD_PALE);
      doc.circle(apexX, apexY - 0.5, 0.65, 'F');
    };

    // ── Header de página ────────────────────────────────────────────────
    const drawHeader = () => {
      // Logo + brand
      drawLogo(margin, 7, 10, 9);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      setText(INK);
      doc.text('ASCENDA PERFORMANCE SpA', margin + 13, 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      setText(INK_MUTE);
      doc.text('SOCIOS EN CRECIMIENTO COMERCIAL', margin + 13, 15.3);

      // Metadata a la derecha
      doc.setFontSize(7);
      setText(INK_MUTE);
      doc.text('Documento contractual', pageW - margin, 11.5, { align: 'right' });
      doc.text(
        `Generado ${new Date().toLocaleDateString('es-CL')}`,
        pageW - margin, 15.3, { align: 'right' },
      );

      // Línea dorada separadora
      setDraw(GOLD);
      doc.setLineWidth(0.5);
      doc.line(margin, 19, pageW - margin, 19);
    };

    // ── Footer de página ────────────────────────────────────────────────
    const drawFooter = (pageNum: number, totalPages: number) => {
      // Línea superior delgada
      setDraw(LINE);
      doc.setLineWidth(0.2);
      doc.line(margin, footerTop, pageW - margin, footerTop);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      setText(INK_MUTE);
      // Línea 1: datos de empresa
      const ascenda = ASCENDA_COMPANY;
      const line1 = `${ascenda.legalName}  ·  RUT ${ascenda.rut}  ·  ${ascenda.address}`;
      doc.text(line1, margin, footerTop + 4);
      // Línea 2: contacto + dominio
      const line2 = `${ascenda.supportEmail}  ·  www.ascenda.cl`;
      setText(GOLD);
      doc.text(line2, margin, footerTop + 8);
      // Numeración a la derecha
      setText(INK_MUTE);
      doc.text(
        `Página ${pageNum} de ${totalPages}`,
        pageW - margin, footerTop + 8, { align: 'right' },
      );
    };

    // ── Helpers de contenido ────────────────────────────────────────────
    let y = headerBottom + 6;
    let pageNum = 1;

    const ensureSpace = (needed: number) => {
      if (y + needed > footerTop - 4) {
        doc.addPage();
        pageNum++;
        drawHeader();
        y = headerBottom + 6;
      }
    };

    // ── Renderizar título + badge de estado ─────────────────────────────
    drawHeader();

    // Título grande
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    setText(INK);
    const titleLines = doc.splitTextToSize(
      sanitize(contract.title || 'Contrato'),
      contentW,
    );
    for (const l of titleLines) {
      ensureSpace(9);
      doc.text(l, margin, y);
      y += 7.5;
    }
    y += 1;

    // Badge-bar con estado + vigencia + organización
    const statusLabels: Record<string, string> = {
      draft: 'BORRADOR',
      pending_signature: 'PENDIENTE DE FIRMA',
      active: 'ACTIVO',
      expired: 'EXPIRADO',
    };
    const statusLabel = statusLabels[contract.status] || contract.status.toUpperCase();
    const vigencia = contract.effectiveDate
      ? new Date(contract.effectiveDate).toLocaleDateString('es-CL')
      : '-';

    ensureSpace(14);
    setFill(BG_SOFT);
    setDraw(GOLD_LIGHT);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, 9, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setText(GOLD);
    doc.text(statusLabel, margin + 3, y + 5.8);
    doc.setFont('helvetica', 'normal');
    setText(INK_SOFT);
    const statusBadgeW = doc.getTextWidth(statusLabel) + 6;
    doc.text(`Vigencia: ${vigencia}`, margin + 3 + statusBadgeW + 4, y + 5.8);
    if (contract.tenant?.name) {
      const orgText = sanitize(`Organización: ${contract.tenant.name}`);
      doc.text(orgText, pageW - margin - 3, y + 5.8, { align: 'right' });
    }
    y += 14;

    // ── Parsear y renderizar contenido ──────────────────────────────────
    const rawContent = contract.content || contract.description || 'Sin contenido';
    const content = sanitize(rawContent).replace(/<[^>]*>/g, '');
    const lines = content.split('\n');

    // Detectores
    const isHR = (s: string) => /^[\s-=_*]{3,}$/.test(s.trim());
    const isBigHeading = (s: string, i: number) => {
      const t = s.trim();
      return (
        i < 3 &&
        t.length >= 12 &&
        /[A-ZÁÉÍÓÚÑ]/.test(t) &&
        !/[a-záéíóúñ]/.test(t) &&
        !t.includes(':') &&
        !t.startsWith('-')
      );
    };
    const isSectionTitle = (s: string) => {
      const t = s.trim();
      if (t.length < 3) return false;
      // "PRIMERO:", "SEGUNDO:", "ENTRE LAS PARTES", "ACUERDO DE ..."
      if (/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ,.()\-]+[:]?$/.test(t) && t.length > 4 && !/[a-záéíóúñ]/.test(t)) return true;
      // "1. DATOS TRATADOS", "2. FINALIDAD DEL ..."
      if (/^\d+\.\s+[A-ZÁÉÍÓÚÑ]/.test(t)) return true;
      // "FIRMAS"
      if (t === 'FIRMAS' || t === 'ACEPTACIÓN' || t === 'ACEPTACION') return true;
      return false;
    };
    const isSubSection = (s: string) => {
      // Cosas como "PROVEEDOR (\"Ascenda\"):", "CLIENTE (\"...\"):"
      const t = s.trim();
      return /^[A-ZÁÉÍÓÚÑ]+\s*\(.*\):\s*$/.test(t);
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      // Línea vacía → espacio vertical pequeño
      if (trimmed === '') {
        y += 2.8;
        continue;
      }

      // Separador horizontal → línea dorada real
      if (isHR(trimmed)) {
        ensureSpace(5);
        y += 1.5;
        setDraw(GOLD);
        doc.setLineWidth(0.35);
        doc.line(margin + 4, y, pageW - margin - 4, y);
        y += 3.5;
        continue;
      }

      // Big heading (título gigante del contrato — solo primeras líneas)
      if (isBigHeading(trimmed, i)) {
        ensureSpace(11);
        y += 1;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        setText(GOLD);
        const wrapped = doc.splitTextToSize(trimmed, contentW);
        for (const l of wrapped) {
          ensureSpace(8);
          doc.text(l, margin, y);
          y += 6.5;
        }
        y += 2;
        continue;
      }

      // Sub-section "PROVEEDOR (...):", "CLIENTE (...):"
      if (isSubSection(trimmed)) {
        ensureSpace(8);
        y += 1;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        setText(GOLD);
        doc.text(trimmed, margin, y);
        y += 5;
        continue;
      }

      // Section title
      if (isSectionTitle(trimmed)) {
        ensureSpace(10);
        y += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        setText(INK);
        const wrapped = doc.splitTextToSize(trimmed, contentW);
        for (const l of wrapped) {
          ensureSpace(6);
          doc.text(l, margin, y);
          y += 5.5;
        }
        y += 1.2;
        continue;
      }

      // Body normal
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      setText(INK);
      const wrapped = doc.splitTextToSize(raw, contentW);
      for (const l of wrapped) {
        ensureSpace(5);
        doc.text(l, margin, y);
        y += 4.7;
      }
    }

    // ── Dibujar footer en TODAS las páginas ─────────────────────────────
    const totalPages = pageNum;
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawFooter(p, totalPages);
    }

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
