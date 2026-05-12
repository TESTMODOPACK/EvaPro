import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EvaluationCycle } from '../../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../../development/entities/development-plan.entity';
import { Contract } from '../../contracts/entities/contract.entity';
import { CalibrationSession } from '../../talent/entities/calibration-session.entity';
import { SignatureRole } from '../entities/document-signature.entity';

/**
 * SignatureAuthorizationService — Gap G1 (audit fix)
 *
 * Centraliza la verificación de "¿puede este usuario firmar este documento?"
 * antes de generar OTP o crear una firma. Sin esta capa, cualquier usuario
 * autenticado podría solicitar OTP / firmar documentos ajenos.
 *
 * Reglas por documentType:
 *  - evaluation_response  → user es el evaluatee de la asignación
 *  - development_plan     → user es plan.userId, o tenant_admin/super_admin
 *  - contract             → solo tenant_admin / super_admin
 *  - calibration_session  → user es session.moderatorId, o tenant_admin/super_admin
 *  - evaluation_cycle     → solo tenant_admin / super_admin
 *
 * super_admin opera multi-tenant; las demás reglas exigen además que el
 * documento exista dentro del tenant del usuario.
 */
@Injectable()
export class SignatureAuthorizationService {
  constructor(
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(DevelopmentPlan)
    private readonly planRepo: Repository<DevelopmentPlan>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(CalibrationSession)
    private readonly calibrationRepo: Repository<CalibrationSession>,
  ) {}

  private static readonly TENANT_LEVEL_ROLES = new Set(['tenant_admin', 'super_admin']);

  /**
   * Verifica que `userId` tenga derecho a firmar el documento `(documentType, documentId)`
   * con el `signatureRole` solicitado, dentro de `tenantId`. Lanza la excepción
   * adecuada en caso contrario.
   *
   * NOTA: el role debe provenir del JWT (req.user.role), nunca del body del request.
   *
   * G2 (TAREA 5): para evaluation_response, distingue:
   *  - signatureRole=RECIPIENT → user debe ser el evaluatee (compat).
   *  - signatureRole=AUTHOR    → user debe ser el evaluator (manager o external).
   *  - signatureRole=EMPLOYER_WITNESS → solo tenant_admin (TAREA 6).
   */
  async assertCanSign(
    tenantId: string,
    userId: string,
    role: string,
    documentType: string,
    documentId: string,
    signatureRole: SignatureRole = SignatureRole.RECIPIENT,
  ): Promise<void> {
    if (!tenantId || !userId || !role || !documentType || !documentId) {
      throw new BadRequestException('Parámetros de autorización incompletos');
    }
    if (!Object.values(SignatureRole).includes(signatureRole)) {
      throw new BadRequestException(`Rol de firma inválido: ${signatureRole}`);
    }

    switch (documentType) {
      case 'evaluation_response':
        return this.assertCanSignEvaluationResponse(tenantId, userId, role, documentId, signatureRole);
      case 'development_plan':
        return this.assertCanSignDevelopmentPlan(tenantId, userId, role, documentId);
      case 'contract':
        return this.assertCanSignContract(tenantId, role, documentId);
      case 'calibration_session':
        return this.assertCanSignCalibrationSession(tenantId, userId, role, documentId);
      case 'evaluation_cycle':
        return this.assertCanSignEvaluationCycle(tenantId, role, documentId);
      default:
        throw new BadRequestException(`Tipo de documento no soportado: ${documentType}`);
    }
  }

  // ─── Reglas por documentType ────────────────────────────────────────

  /**
   * evaluation_response: las reglas dependen de `signatureRole`:
   *  - RECIPIENT: firmante debe ser el evaluatee (caso histórico — employee firma feedback recibido).
   *  - AUTHOR: firmante debe ser el evaluator de la asignación (G2 — manager/external firma feedback emitido).
   *  - EMPLOYER_WITNESS: solo tenant_admin/super_admin (G3, TAREA 6).
   *
   * super_admin se permite por trazabilidad forense en todos los casos.
   */
  private async assertCanSignEvaluationResponse(
    tenantId: string,
    userId: string,
    role: string,
    documentId: string,
    signatureRole: SignatureRole,
  ): Promise<void> {
    const response = await this.responseRepo.findOne({
      where: { id: documentId, tenantId },
      select: ['id', 'assignmentId', 'tenantId'],
    });
    if (!response) {
      throw new NotFoundException('Respuesta de evaluación no encontrada');
    }

    if (role === 'super_admin') return;

    // G3 (TAREA 6) — employer_witness solo tenant_admin
    if (signatureRole === SignatureRole.EMPLOYER_WITNESS) {
      if (role !== 'tenant_admin') {
        throw new ForbiddenException('Solo tenant_admin puede firmar como employer_witness');
      }
      return;
    }

    const assignment = await this.assignmentRepo.findOne({
      where: { id: response.assignmentId, tenantId },
      select: ['id', 'evaluateeId', 'evaluatorId', 'tenantId'],
    });
    if (!assignment) {
      throw new NotFoundException('Asignación de evaluación no encontrada');
    }

    // G2 (TAREA 5) — AUTHOR: firmante debe ser el evaluator
    if (signatureRole === SignatureRole.AUTHOR) {
      // Roles permitidos para firmar como autor: manager, external, tenant_admin
      const authorRolesAllowed = new Set(['manager', 'external', 'tenant_admin']);
      if (!authorRolesAllowed.has(role)) {
        throw new ForbiddenException('Tu rol no puede firmar como autor del feedback');
      }
      if (assignment.evaluatorId !== userId) {
        throw new ForbiddenException('Solo el evaluador original puede firmar esta evaluación como autor');
      }
      return;
    }

    // RECIPIENT (default histórico)
    if (assignment.evaluateeId !== userId) {
      throw new ForbiddenException('No tienes permiso para firmar esta evaluación');
    }
  }

  /**
   * development_plan: el firmante debe ser el dueño del plan, o tenant_admin/super_admin.
   */
  private async assertCanSignDevelopmentPlan(
    tenantId: string,
    userId: string,
    role: string,
    documentId: string,
  ): Promise<void> {
    const plan = await this.planRepo.findOne({
      where: { id: documentId, tenantId },
      select: ['id', 'userId', 'tenantId'],
    });
    if (!plan) {
      throw new NotFoundException('Plan de desarrollo no encontrado');
    }

    if (SignatureAuthorizationService.TENANT_LEVEL_ROLES.has(role)) return;

    if (plan.userId !== userId) {
      throw new ForbiddenException('No tienes permiso para firmar este plan de desarrollo');
    }
  }

  /**
   * contract: solo tenant_admin / super_admin pueden firmar contratos.
   */
  private async assertCanSignContract(
    tenantId: string,
    role: string,
    documentId: string,
  ): Promise<void> {
    if (!SignatureAuthorizationService.TENANT_LEVEL_ROLES.has(role)) {
      throw new ForbiddenException('No tienes permiso para firmar contratos');
    }
    const contract = await this.contractRepo.findOne({
      where: { id: documentId, tenantId },
      select: ['id', 'tenantId'],
    });
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }
  }

  /**
   * calibration_session: el moderador de la sesión, o tenant_admin/super_admin.
   */
  private async assertCanSignCalibrationSession(
    tenantId: string,
    userId: string,
    role: string,
    documentId: string,
  ): Promise<void> {
    const session = await this.calibrationRepo.findOne({
      where: { id: documentId, tenantId },
      select: ['id', 'moderatorId', 'tenantId'],
    });
    if (!session) {
      throw new NotFoundException('Sesión de calibración no encontrada');
    }

    if (SignatureAuthorizationService.TENANT_LEVEL_ROLES.has(role)) return;

    if (session.moderatorId !== userId) {
      throw new ForbiddenException('No tienes permiso para firmar esta sesión de calibración');
    }
  }

  /**
   * evaluation_cycle: solo tenant_admin / super_admin pueden firmar ciclos completos.
   */
  private async assertCanSignEvaluationCycle(
    tenantId: string,
    role: string,
    documentId: string,
  ): Promise<void> {
    if (!SignatureAuthorizationService.TENANT_LEVEL_ROLES.has(role)) {
      throw new ForbiddenException('No tienes permiso para firmar ciclos de evaluación');
    }
    const cycle = await this.cycleRepo.findOne({
      where: { id: documentId, tenantId },
      select: ['id', 'tenantId'],
    });
    if (!cycle) {
      throw new NotFoundException('Ciclo de evaluación no encontrado');
    }
  }
}
