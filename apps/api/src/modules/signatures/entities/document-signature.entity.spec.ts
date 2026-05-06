/**
 * document-signature.entity.spec.ts — TAREA 4.
 *
 * Tests del modelo extendido para roles de firma. Verifica:
 *  - Los enums SignatureRole y AcknowledgmentType tienen los valores
 *    esperados (alineados con el CHECK constraint de la migración).
 *  - La entidad DocumentSignature expone los nuevos campos.
 *  - Los defaults (signatureRole='recipient') se aplican en create().
 */
import { getMetadataArgsStorage } from 'typeorm';
import {
  AcknowledgmentType,
  DocumentSignature,
  SignatureRole,
} from './document-signature.entity';

describe('DocumentSignature entity model (TAREA 4)', () => {
  describe('SignatureRole enum', () => {
    it('expone exactamente los valores permitidos por el CHECK constraint', () => {
      expect(Object.values(SignatureRole).sort()).toEqual(
        ['author', 'employer_witness', 'recipient'].sort(),
      );
    });

    it('valores son strings (no number-enums)', () => {
      Object.values(SignatureRole).forEach((v) => {
        expect(typeof v).toBe('string');
      });
    });
  });

  describe('AcknowledgmentType enum', () => {
    it('expone exactamente los valores permitidos por el CHECK constraint', () => {
      expect(Object.values(AcknowledgmentType).sort()).toEqual(
        ['agree', 'agree_with_comments', 'decline'].sort(),
      );
    });
  });

  describe('columnas de la entidad', () => {
    function getColumn(name: string) {
      return getMetadataArgsStorage().columns.find(
        (c) => c.target === DocumentSignature && c.propertyName === name,
      );
    }

    it('signatureRole: varchar(30), default RECIPIENT, NOT NULL', () => {
      const col = getColumn('signatureRole');
      expect(col).toBeDefined();
      expect(col!.options.type).toBe('varchar');
      expect(col!.options.length).toBe(30);
      expect(col!.options.default).toBe(SignatureRole.RECIPIENT);
      expect(col!.options.name).toBe('signature_role');
      // Sin nullable explícito = NOT NULL por default en TypeORM
      expect(col!.options.nullable).not.toBe(true);
    });

    it('acknowledgmentType: varchar(30), nullable', () => {
      const col = getColumn('acknowledgmentType');
      expect(col).toBeDefined();
      expect(col!.options.type).toBe('varchar');
      expect(col!.options.length).toBe(30);
      expect(col!.options.nullable).toBe(true);
      expect(col!.options.name).toBe('acknowledgment_type');
    });

    it('acknowledgmentComment: text, nullable', () => {
      const col = getColumn('acknowledgmentComment');
      expect(col).toBeDefined();
      expect(col!.options.type).toBe('text');
      expect(col!.options.nullable).toBe(true);
      expect(col!.options.name).toBe('acknowledgment_comment');
    });
  });

  describe('índice idx_dsig_doc_role', () => {
    it('está registrado para queries de "firmas X tipo de un documento"', () => {
      const indices = getMetadataArgsStorage().indices.filter(
        (i) => i.target === DocumentSignature,
      );
      const idxDocRole = indices.find((i) => i.name === 'idx_dsig_doc_role');
      expect(idxDocRole).toBeDefined();
      expect(idxDocRole!.columns).toEqual([
        'tenantId', 'documentType', 'documentId', 'signatureRole',
      ]);
    });
  });
});
