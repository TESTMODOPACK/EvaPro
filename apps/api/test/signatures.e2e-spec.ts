/**
 * signatures.e2e-spec.ts — TAREA 2 / G7 (audit baseline).
 *
 * E2E HTTP-level del SignaturesController. NO requiere base de datos:
 * usa overrideProvider para mockear los repos y servicios pesados, pero
 * exercita los guards reales (AuthGuard mock + RolesGuard real) + pipes
 * + routing.
 *
 * Flujos cubiertos:
 *  - HTTP 201 al solicitar firma con rol válido
 *  - HTTP 403 al intentar listAll con rol manager (RolesGuard real)
 *  - HTTP 400 si ParseUUIDPipe recibe UUID malformado
 *  - Propagación de role del JWT al service para auditoría G1
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AuthGuard } from '@nestjs/passport';

import { SignaturesController } from '../src/modules/signatures/signatures.controller';
import { SignaturesService } from '../src/modules/signatures/signatures.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../src/modules/audit/audit.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const USER_A = '22222222-2222-2222-2222-222222222222';
const DOC_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Mock AuthGuard JWT que inyecta `req.user` con role configurable
 * vía un closure mutable. Cada test setea el role antes de hacer la llamada.
 */
function buildMockJwtGuard(state: { role: string }): CanActivate {
  return {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      req.user = { tenantId: TENANT_A, userId: USER_A, role: state.role };
      return true;
    },
  };
}

describe('Signatures (e2e)', () => {
  let app: INestApplication;
  const userState: { role: string } = { role: 'employee' };
  const service: any = {
    requestSignature: jest.fn().mockResolvedValue({ message: 'ok', expiryMinutes: 10 }),
    verifyAndSign: jest.fn().mockResolvedValue({ id: 'sig-1', signedAt: new Date() }),
    getSignaturesByUser: jest.fn().mockResolvedValue([]),
    getSignaturesByTeam: jest.fn().mockResolvedValue([]),
    verifyIntegrity: jest.fn().mockResolvedValue({ integrity: 'valid' }),
    getSignatures: jest.fn().mockResolvedValue([]),
    getSignaturesByTenant: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SignaturesController],
      providers: [
        { provide: SignaturesService, useValue: service },
        // RolesGuard real (con AuditService opcional mockeado)
        RolesGuard,
        Reflector,
        { provide: AuditService, useValue: { log: jest.fn(), logFailure: jest.fn().mockResolvedValue(undefined) } },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(buildMockJwtGuard(userState))
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    Object.values(service).forEach((m: any) => m.mockClear?.());
    userState.role = 'employee';
  });

  // ─── role propagation (G1) ──────────────────────────────────────────

  it('POST /signatures/request — propaga role del JWT al service', async () => {
    userState.role = 'manager';
    const res = await request(app.getHttpServer())
      .post('/signatures/request')
      .send({ documentType: 'evaluation_response', documentId: DOC_ID })
      .expect(201);

    expect(res.body).toMatchObject({ message: expect.any(String), expiryMinutes: 10 });
    expect(service.requestSignature).toHaveBeenCalledWith(
      TENANT_A, USER_A, 'manager', 'evaluation_response', DOC_ID,
      undefined, // signAs?: { signatureRole? }
    );
  });

  it('POST /signatures/verify — propaga role y código', async () => {
    userState.role = 'employee';
    await request(app.getHttpServer())
      .post('/signatures/verify')
      .send({ documentType: 'evaluation_response', documentId: DOC_ID, code: '123456' })
      .expect(201);

    expect(service.verifyAndSign).toHaveBeenCalledWith(
      TENANT_A, USER_A, 'employee', 'evaluation_response', DOC_ID, '123456',
      expect.any(String),
      undefined, // sin acknowledgment → default 'agree' en el service (G5)
      undefined, // sin signAs → default RECIPIENT (G2)
    );
  });

  // ─── RolesGuard real ─────────────────────────────────────────────────

  it('GET /signatures (listAll) → 403 para rol manager', async () => {
    userState.role = 'manager';
    await request(app.getHttpServer()).get('/signatures').expect(403);
    expect(service.getSignaturesByTenant).not.toHaveBeenCalled();
  });

  it('GET /signatures (listAll) → 200 para tenant_admin', async () => {
    userState.role = 'tenant_admin';
    await request(app.getHttpServer()).get('/signatures').expect(200);
    expect(service.getSignaturesByTenant).toHaveBeenCalledWith(TENANT_A);
  });

  it('GET /signatures (listAll) → 403 para external (rol no autorizado para firmas)', async () => {
    userState.role = 'external';
    await request(app.getHttpServer()).get('/signatures').expect(403);
  });

  it('POST /signatures/request → 201 para rol external (G4)', async () => {
    userState.role = 'external';
    await request(app.getHttpServer())
      .post('/signatures/request')
      .send({ documentType: 'evaluation_response', documentId: DOC_ID })
      .expect(201);
    expect(service.requestSignature).toHaveBeenCalledWith(
      TENANT_A, USER_A, 'external', 'evaluation_response', DOC_ID,
      undefined,
    );
  });

  it('GET /signatures/team → 403 para external (sin equipo)', async () => {
    userState.role = 'external';
    await request(app.getHttpServer()).get('/signatures/team').expect(403);
  });

  it('GET /signatures/verify/:id → 403 para external (no acceso forense)', async () => {
    userState.role = 'external';
    await request(app.getHttpServer())
      .get(`/signatures/verify/${DOC_ID}`)
      .expect(403);
  });

  it('GET /signatures/team → 403 para employee', async () => {
    userState.role = 'employee';
    await request(app.getHttpServer()).get('/signatures/team').expect(403);
  });

  it('GET /signatures/team → 200 para manager (filtra por su userId)', async () => {
    userState.role = 'manager';
    await request(app.getHttpServer()).get('/signatures/team').expect(200);
    expect(service.getSignaturesByTeam).toHaveBeenCalledWith(TENANT_A, USER_A);
  });

  // ─── ParseUUIDPipe ───────────────────────────────────────────────────

  it('GET /signatures/verify/:id → 400 si UUID malformado', async () => {
    userState.role = 'manager';
    await request(app.getHttpServer())
      .get('/signatures/verify/not-a-uuid')
      .expect(400);
    expect(service.verifyIntegrity).not.toHaveBeenCalled();
  });

  it('GET /signatures/document/:type/:id → 400 si UUID del documento es malformado', async () => {
    userState.role = 'manager';
    await request(app.getHttpServer())
      .get('/signatures/document/evaluation_response/not-a-uuid')
      .expect(400);
  });
});
