import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { DocumentSignature } from './entities/document-signature.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';

const OTP_EXPIRY_MINUTES = 10;

@Injectable()
export class SignaturesService {
  constructor(
    @InjectRepository(DocumentSignature)
    private readonly signatureRepo: Repository<DocumentSignature>,
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
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Request Signature (send OTP) ───────────────────────────────────

  async requestSignature(tenantId: string, userId: string, documentType: string, documentId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Validate document exists
    const docName = await this.getDocumentName(tenantId, documentType, documentId);

    // Generate cryptographically secure 6-digit OTP
    const code = String(crypto.randomInt(100000, 999999));
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP in dedicated signature fields (not shared with password reset)
    user.signatureOtp = code;
    user.signatureOtpExpires = expires;
    await this.userRepo.save(user);

    // Send OTP email
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
    documentType: string,
    documentId: string,
    otpCode: string,
    ipAddress?: string,
  ): Promise<DocumentSignature> {
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Check for existing valid signature (prevent duplicates)
    const existing = await this.signatureRepo.findOne({
      where: { tenantId, documentType, documentId, signedBy: userId, status: 'valid' },
    });
    if (existing) {
      throw new BadRequestException('Este documento ya fue firmado por ti.');
    }

    // Verify OTP (dedicated signature fields)
    if (!user.signatureOtp || user.signatureOtp !== otpCode) {
      throw new BadRequestException('Código de verificación inválido');
    }
    if (!user.signatureOtpExpires || new Date() > user.signatureOtpExpires) {
      throw new BadRequestException('El código de verificación ha expirado. Solicita uno nuevo.');
    }

    // Clear OTP
    user.signatureOtp = null;
    user.signatureOtpExpires = null;
    await this.userRepo.save(user);

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
    });
    const saved = await this.signatureRepo.save(signature);

    // Audit log
    this.auditService.log(
      tenantId, userId, 'document.signed', 'signature', saved.id,
      { documentType, documentId, documentHash, verificationMethod: 'otp_email' },
      ipAddress,
    ).catch(() => {});

    // Auto-activate contract after signature
    if (documentType === 'contract') {
      const contract = await this.contractRepo.findOne({ where: { id: documentId, tenantId } });
      if (contract && contract.status === 'pending_signature') {
        contract.status = 'active';
        await this.contractRepo.save(contract);
      }
    }

    return saved;
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
        return JSON.stringify({ id: documentId, type: 'calibration_session', tenantId });
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
      case 'calibration_session':
        return `Sesión de Calibración ${documentId.slice(0, 8)}`;
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
}
