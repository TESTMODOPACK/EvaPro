import { Injectable, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { AcknowledgmentType, DocumentSignature, SignatureRole } from './entities/document-signature.entity';
import { SignatureOtpToken } from './entities/signature-otp-token.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { CalibrationSession } from '../talent/entities/calibration-session.entity';
import { CalibrationEntry } from '../talent/entities/calibration-entry.entity';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';
import { SignatureAuthorizationService } from './services/signature-authorization.service';

const OTP_EXPIRY_MINUTES = 10;
// G9: rate limiting
const MAX_ACTIVE_TOKENS_PER_USER_PER_HOUR = 3;
const MAX_ATTEMPTS_PER_TOKEN = 5;
// Bcrypt rounds: 10 da ~50ms hash; balance entre seguridad y latencia.
const OTP_BCRYPT_ROUNDS = 10;
// G5 (TAREA 7): comentario obligatorio cuando acknowledgmentType !== 'agree'.
const ACK_COMMENT_MIN_LENGTH = 10;
const ACK_COMMENT_MAX_LENGTH = 2000;

/** TAREA 7 / G5 — opciones de acknowledgment al firmar. */
export interface AcknowledgmentOptions {
  type?: AcknowledgmentType;
  comment?: string;
}

@Injectable()
export class SignaturesService {
  constructor(
    @InjectRepository(DocumentSignature)
    private readonly signatureRepo: Repository<DocumentSignature>,
    @InjectRepository(SignatureOtpToken)
    private readonly otpRepo: Repository<SignatureOtpToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(DevelopmentPlan)
    private readonly planRepo: Repository<DevelopmentPlan>,
    @InjectRepository(DevelopmentAction)
    private readonly actionRepo: Repository<DevelopmentAction>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(CalibrationSession)
    private readonly calibrationRepo: Repository<CalibrationSession>,
    @InjectRepository(CalibrationEntry)
    private readonly calibrationEntryRepo: Repository<CalibrationEntry>,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
    private readonly authorizationService: SignatureAuthorizationService,
  ) {}

  // ─── Request Signature (send OTP) ───────────────────────────────────

  async requestSignature(
    tenantId: string,
    userId: string,
    role: string,
    documentType: string,
    documentId: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // G1 audit fix: validar autorización del firmante sobre este documento
    // antes de emitir OTP. Sin esto cualquier usuario podía solicitar OTP
    // para firmar documentos ajenos.
    await this.authorizationService.assertCanSign(tenantId, userId, role, documentType, documentId);

    // G9 audit fix: rate limiting — max 3 tokens activos del user en la
    // última hora. Previene flood de OTPs (mail bombing, brute force prep).
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentActiveCount = await this.otpRepo.count({
      where: {
        userId,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
        createdAt: MoreThan(oneHourAgo),
      },
    });
    if (recentActiveCount >= MAX_ACTIVE_TOKENS_PER_USER_PER_HOUR) {
      throw new HttpException(
        'Has solicitado demasiados códigos de verificación recientemente. Intenta nuevamente en una hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Validate document exists (idempotente con assertCanSign, sirve para nombre)
    const docName = await this.getDocumentName(tenantId, documentType, documentId);

    // Generate cryptographically secure 6-digit OTP (plaintext SOLO para email)
    const code = String(crypto.randomInt(100000, 999999));
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // G9: hashear con bcrypt antes de persistir. Plaintext NUNCA toca DB.
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
    await this.otpRepo.save(
      this.otpRepo.create({
        tenantId, userId, documentType, documentId,
        codeHash, expiresAt: expires,
      }),
    );

    // Send OTP email (plaintext, una sola vez)
    await this.emailService.sendSignatureOtp(user.email, {
      firstName: user.firstName,
      documentType: this.getDocumentTypeLabel(documentType),
      documentName: docName,
      code,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    });

    return { message: 'Código de verificación enviado a tu correo', expiryMinutes: OTP_EXPIRY_MINUTES };
  }

  // ─── Verify OTP and Sign ────────────────────────────────────────────

  async verifyAndSign(
    tenantId: string,
    userId: string,
    role: string,
    documentType: string,
    documentId: string,
    otpCode: string,
    ipAddress?: string,
    acknowledgment?: AcknowledgmentOptions,
  ): Promise<DocumentSignature> {
    // G5 (TAREA 7): validar acknowledgment antes de cualquier side-effect
    const ackType = acknowledgment?.type ?? AcknowledgmentType.AGREE;
    const ackComment = acknowledgment?.comment?.trim() || null;
    this.validateAcknowledgment(ackType, ackComment);

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // G1 audit fix: defense in depth — re-validar autorización al firmar,
    // por si el documento fue eliminado/transferido entre request y verify.
    await this.authorizationService.assertCanSign(tenantId, userId, role, documentType, documentId);

    // Check for existing valid signature (prevent duplicates)
    const existing = await this.signatureRepo.findOne({
      where: { tenantId, documentType, documentId, signedBy: userId, status: 'valid' },
    });
    if (existing) {
      throw new BadRequestException('Este documento ya fue firmado por ti.');
    }

    // G9: Buscar el token activo más reciente para (user, documentType, documentId).
    const token = await this.otpRepo.findOne({
      where: {
        tenantId, userId, documentType, documentId,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
    if (!token) {
      // Mensaje genérico para no revelar si fue inválido / expirado / inexistente
      throw new BadRequestException('Código de verificación inválido o expirado. Solicita uno nuevo.');
    }

    // G9: defensa anti-bruteforce. Si llegó al cap, token bloqueado.
    if (token.attempts >= MAX_ATTEMPTS_PER_TOKEN) {
      throw new BadRequestException('Has agotado los intentos para este código. Solicita uno nuevo.');
    }

    // G9: incremento atómico de attempts ANTES de comparar (defensa contra
    // race conditions concurrentes). Si dos verificaciones llegan a la vez,
    // el WHERE attempts < MAX evita exceder el cap.
    const updateRes = await this.otpRepo
      .createQueryBuilder()
      .update(SignatureOtpToken)
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id AND attempts < :max', { id: token.id, max: MAX_ATTEMPTS_PER_TOKEN })
      .execute();
    if (!updateRes.affected) {
      // Otro request lo bloqueó entre nuestro findOne y update
      throw new BadRequestException('Has agotado los intentos para este código. Solicita uno nuevo.');
    }

    // Comparación con bcrypt (constant time)
    const matches = await bcrypt.compare(otpCode, token.codeHash);
    if (!matches) {
      throw new BadRequestException('Código de verificación inválido o expirado. Solicita uno nuevo.');
    }

    // OTP válido → marcar token como consumido (no reutilizable)
    await this.otpRepo.update(token.id, { consumedAt: new Date() });

    // Generate document hash
    const documentContent = await this.getDocumentContent(tenantId, documentType, documentId);
    const documentHash = crypto.createHash('sha256').update(documentContent).digest('hex');
    const documentName = await this.getDocumentName(tenantId, documentType, documentId);

    // Create signature
    const signature = this.signatureRepo.create({
      tenantId,
      documentType,
      documentId,
      documentName,
      documentHash,
      signedBy: userId,
      signerIp: ipAddress || null,
      verificationMethod: 'otp_email',
      status: 'valid',
      // G5 (TAREA 7): registrar acknowledgmentType + comment.
      // signatureRole queda en RECIPIENT (default); endpoints específicos
      // (TAREA 5 author / TAREA 6 employer_witness) lo overridean.
      signatureRole: SignatureRole.RECIPIENT,
      acknowledgmentType: ackType,
      acknowledgmentComment: ackComment,
    });
    const saved = await this.signatureRepo.save(signature);

    // Audit log (incluye acknowledgmentType para trazabilidad legal)
    this.auditService.log(
      tenantId, userId, 'document.signed', 'signature', saved.id,
      {
        documentType, documentId, documentHash,
        verificationMethod: 'otp_email',
        acknowledgmentType: ackType,
        hasComment: !!ackComment,
      },
      ipAddress,
    ).catch(() => {});

    // G5 (TAREA 7): si fue DECLINE, NO transicionar estados del documento.
    // El contrato queda como pending_signature; el rechazo queda registrado
    // en la firma como evidencia legal. Solo AGREE / AGREE_WITH_COMMENTS
    // disparan la auto-activación.
    const isAffirmative = ackType !== AcknowledgmentType.DECLINE;
    if (isAffirmative && documentType === 'contract') {
      const contract = await this.contractRepo.findOne({ where: { id: documentId, tenantId } });
      if (contract && contract.status === 'pending_signature') {
        contract.status = 'active';
        await this.contractRepo.save(contract);
      }
    }

    return saved;
  }

  /**
   * G5 (TAREA 7) — valida la combinación acknowledgmentType + comment.
   *
   *  - 'agree' acepta comment vacío.
   *  - 'agree_with_comments' y 'decline' EXIGEN comment con min/max length.
   */
  private validateAcknowledgment(type: AcknowledgmentType, comment: string | null) {
    if (!Object.values(AcknowledgmentType).includes(type)) {
      throw new BadRequestException('Tipo de reconocimiento inválido');
    }
    if (type === AcknowledgmentType.AGREE) {
      // comment opcional; ignoramos si vino
      return;
    }
    if (!comment || comment.length < ACK_COMMENT_MIN_LENGTH) {
      throw new BadRequestException(
        `Para "${type}" debes incluir un comentario de al menos ${ACK_COMMENT_MIN_LENGTH} caracteres.`,
      );
    }
    if (comment.length > ACK_COMMENT_MAX_LENGTH) {
      throw new BadRequestException(
        `El comentario no puede superar los ${ACK_COMMENT_MAX_LENGTH} caracteres.`,
      );
    }
  }

  // ─── List Signatures ────────────────────────────────────────────────

  async getSignatures(tenantId: string, documentType: string, documentId: string) {
    return this.signatureRepo.find({
      where: { tenantId, documentType, documentId },
      relations: ['signer'],
      order: { signedAt: 'DESC' },
    });
  }

  async getSignaturesByTenant(tenantId: string) {
    return this.signatureRepo.find({
      where: { tenantId },
      relations: ['signer'],
      order: { signedAt: 'DESC' },
      take: 100,
    });
  }

  /** Signatures created by a specific user */
  async getSignaturesByUser(tenantId: string, userId: string) {
    return this.signatureRepo.find({
      where: { tenantId, signedBy: userId },
      relations: ['signer'],
      order: { signedAt: 'DESC' },
    });
  }

  /** Signatures of a manager's direct reports (or all if managerId is undefined = admin) */
  async getSignaturesByTeam(tenantId: string, managerId?: string) {
    // Get team member IDs
    const whereClause: any = { tenantId, isActive: true };
    if (managerId) whereClause.managerId = managerId;
    const teamMembers = await this.userRepo.find({ where: whereClause, select: ['id'] });
    const memberIds = teamMembers.map(u => u.id);
    if (memberIds.length === 0) return [];

    return this.signatureRepo
      .createQueryBuilder('sig')
      .leftJoinAndSelect('sig.signer', 'signer')
      .where('sig.tenantId = :tenantId', { tenantId })
      .andWhere('sig.signedBy IN (:...memberIds)', { memberIds })
      .orderBy('sig.signedAt', 'DESC')
      .take(200)
      .getMany();
  }

  // ─── Verify Integrity ──────────────────────────────────────────────

  async verifyIntegrity(tenantId: string, signatureId: string) {
    const signature = await this.signatureRepo.findOne({
      where: { id: signatureId, tenantId },
      relations: ['signer'],
    });
    if (!signature) throw new NotFoundException('Firma no encontrada');

    try {
      const currentContent = await this.getDocumentContent(tenantId, signature.documentType, signature.documentId);
      const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');

      const integrity = currentHash === signature.documentHash;

      return {
        signatureId: signature.id,
        documentType: signature.documentType,
        documentId: signature.documentId,
        documentName: signature.documentName,
        signedBy: signature.signer ? `${signature.signer.firstName} ${signature.signer.lastName}` : signature.signedBy,
        signedAt: signature.signedAt,
        signerIp: signature.signerIp,
        originalHash: signature.documentHash,
        currentHash,
        integrity: integrity ? 'valid' : 'modified',
        message: integrity
          ? 'El documento no ha sido modificado desde la firma.'
          : 'ADVERTENCIA: El documento ha sido modificado después de la firma.',
      };
    } catch {
      return {
        signatureId: signature.id,
        integrity: 'unknown',
        message: 'No se pudo verificar la integridad. El documento puede haber sido eliminado.',
      };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async getDocumentContent(tenantId: string, documentType: string, documentId: string): Promise<string> {
    switch (documentType) {
      case 'evaluation_cycle': {
        const cycle = await this.cycleRepo.findOne({ where: { id: documentId, tenantId } });
        if (!cycle) throw new NotFoundException('Ciclo no encontrado');
        return JSON.stringify({
          id: cycle.id, name: cycle.name, type: cycle.type, status: cycle.status,
          startDate: cycle.startDate, endDate: cycle.endDate, totalEvaluated: cycle.totalEvaluated,
        });
      }
      case 'evaluation_response': {
        const response = await this.responseRepo.findOne({ where: { id: documentId, tenantId } });
        if (!response) throw new NotFoundException('Respuesta no encontrada');
        return JSON.stringify({
          id: response.id, assignmentId: response.assignmentId,
          answers: response.answers, overallScore: response.overallScore, submittedAt: response.submittedAt,
        });
      }
      case 'development_plan': {
        const plan = await this.planRepo.findOne({ where: { id: documentId, tenantId } });
        if (!plan) throw new NotFoundException('Plan no encontrado');
        const actions = await this.actionRepo.find({ where: { planId: documentId, tenantId } });
        return JSON.stringify({
          id: plan.id, title: (plan as any).title, status: plan.status,
          completedAt: (plan as any).completedAt,
          actions: actions.map((a) => ({ id: a.id, title: a.title, status: a.status })),
        });
      }
      case 'calibration_session': {
        // G10 (TAREA 11): hash sobre contenido REAL — antes era stub
        // {id, type, tenantId} que daba integridad ficticia.
        const session = await this.calibrationRepo.findOne({ where: { id: documentId, tenantId } });
        if (!session) throw new NotFoundException('Sesión de calibración no encontrada');
        const entries = await this.calibrationEntryRepo.find({
          where: { sessionId: documentId },
          order: { id: 'ASC' }, // orden estable para hash reproducible
        });
        return this.canonicalJson({
          id: session.id,
          name: session.name,
          status: session.status,
          departmentId: session.departmentId,
          moderatorId: session.moderatorId,
          minQuorum: session.minQuorum,
          expectedDistribution: session.expectedDistribution,
          notes: session.notes,
          // entries en orden estable; cada uno serializado solo con campos
          // de contenido (no timestamps de filas)
          entries: entries.map((e) => ({
            id: e.id,
            userId: e.userId,
            originalScore: e.originalScore,
            adjustedScore: e.adjustedScore,
            originalPotential: e.originalPotential,
            adjustedPotential: e.adjustedPotential,
            rationale: e.rationale,
            status: e.status,
            approvalStatus: e.approvalStatus,
          })),
        });
      }
      case 'contract': {
        const contract = await this.contractRepo.findOne({ where: { id: documentId, tenantId } });
        if (!contract) throw new NotFoundException('Contrato no encontrado');
        return JSON.stringify({
          id: contract.id, type: contract.type, title: contract.title,
          content: contract.content || '', effectiveDate: contract.effectiveDate,
          version: contract.version, tenantId: contract.tenantId,
        });
      }
      default:
        throw new BadRequestException(`Tipo de documento no soportado: ${documentType}`);
    }
  }

  private async getDocumentName(tenantId: string, documentType: string, documentId: string): Promise<string> {
    switch (documentType) {
      case 'evaluation_cycle': {
        const cycle = await this.cycleRepo.findOne({ where: { id: documentId, tenantId }, select: ['id', 'name'] });
        return cycle?.name || `Ciclo ${documentId.slice(0, 8)}`;
      }
      case 'development_plan': {
        const plan = await this.planRepo.findOne({ where: { id: documentId, tenantId } });
        return (plan as any)?.title || `Plan ${documentId.slice(0, 8)}`;
      }
      case 'evaluation_response':
        return `Evaluación ${documentId.slice(0, 8)}`;
      case 'calibration_session': {
        const session = await this.calibrationRepo.findOne({
          where: { id: documentId, tenantId }, select: ['id', 'name'],
        });
        return session?.name || `Sesión de Calibración ${documentId.slice(0, 8)}`;
      }
      case 'contract': {
        const contract = await this.contractRepo.findOne({ where: { id: documentId, tenantId }, select: ['id', 'title'] });
        return contract?.title || `Contrato ${documentId.slice(0, 8)}`;
      }
      default:
        return `Documento ${documentId.slice(0, 8)}`;
    }
  }

  private getDocumentTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      evaluation_cycle: 'Ciclo de Evaluación',
      calibration_session: 'Sesión de Calibración',
      development_plan: 'Plan de Desarrollo',
      evaluation_response: 'Evaluación Individual',
      contract: 'Contrato',
    };
    return labels[type] || type;
  }

  /**
   * G10 (TAREA 11) — Serialización canónica con orden de keys estable
   * para hashes reproducibles. JSON.stringify default no garantiza orden,
   * lo cual rompía la integridad cuando el motor JS reordenaba keys.
   *
   * - Objects: keys ordenadas alfabéticamente.
   * - Arrays: orden preservado (el caller debe pre-ordenar).
   * - Primitivos: tal cual.
   * - null/undefined: null.
   */
  private canonicalJson(value: any): string {
    return JSON.stringify(this.canonicalize(value));
  }

  private canonicalize(value: any): any {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map((v) => this.canonicalize(v));
    if (typeof value === 'object') {
      const sortedKeys = Object.keys(value).sort();
      const out: Record<string, any> = {};
      for (const k of sortedKeys) out[k] = this.canonicalize(value[k]);
      return out;
    }
    return value;
  }
}
