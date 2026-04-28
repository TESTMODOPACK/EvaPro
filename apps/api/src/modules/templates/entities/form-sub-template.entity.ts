import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { FormTemplate } from './form-template.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { RelationType } from '../../evaluations/entities/evaluation-assignment.entity';

/**
 * FormSubTemplate — Fase 3 plan auditoria evaluaciones (Opción A).
 *
 * Una FormTemplate "padre" agrupa N subplantillas, una por cada tipo de
 * evaluador (self / manager / peer / direct_report / external). Cada
 * subplantilla tiene su propio set de secciones/preguntas y un `weight`
 * que pondera su contribución al score final del ciclo.
 *
 * **Por qué este modelo (Opción A) y no `applicableTo` (Fase 2)?**
 *
 *   - Mental model más claro: el admin "ve" 4 subplantillas en pestañas,
 *     no una sola plantilla con preguntas etiquetadas.
 *   - Pesos por evaluador habilitan el motor de cálculo ponderado
 *     (insumo crítico para reports y AI insights).
 *   - Cada subplantilla puede evolucionar independientemente: agregar
 *     una pregunta solo para `peer` no afecta lo que ve `manager`.
 *   - Plantillas Fase 2 (con `applicableTo` en sections) siguen siendo
 *     LEGACY válidas: el service migra inline al primer GET (genera
 *     sub_templates a partir del padre + applicableTo).
 *
 * **Backwards-compat:**
 *   - Plantillas Fase 2 sin sub_templates: el `evaluations.service` cae
 *     en el path legacy (filterTemplateForRelation sobre sections del
 *     padre). Sin breaking change.
 *   - Una vez que se accede a la plantilla por la UI, el service
 *     auto-genera las sub_templates desde el padre (one-time migration).
 *
 * **UNIQUE constraint:** (parent_template_id, relation_type) — una
 * plantilla no puede tener dos subplantillas para el mismo evaluador.
 */
@Entity('form_sub_templates')
@Unique('uq_sub_template_parent_relation', ['parentTemplateId', 'relationType'])
@Index('idx_sub_templates_parent', ['parentTemplateId'])
@Index('idx_sub_templates_tenant', ['tenantId'])
export class FormSubTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Tenant owner — redundante con form_templates.tenant_id pero
   * indispensable para RLS (F4 plan). Las plantillas globales
   * (system templates) tienen `tenant_id = NULL` igual que el padre.
   * Se mantiene en sync via service (cuando se crea, se copia del padre).
   */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @ManyToOne(() => Tenant, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * FK al FormTemplate padre. ON DELETE CASCADE: si se borra el
   * template padre, todas sus subplantillas se borran con él (no
   * tiene sentido una subplantilla huérfana).
   */
  @Column({ type: 'uuid', name: 'parent_template_id' })
  parentTemplateId: string;

  @ManyToOne(() => FormTemplate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_template_id' })
  parentTemplate: FormTemplate;

  /**
   * Tipo de evaluador que responde esta subplantilla. Reusa el enum
   * RelationType del módulo evaluations (single source of truth).
   */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'relation_type',
  })
  relationType: RelationType;

  /**
   * Secciones y preguntas propias de esta subplantilla. Misma forma
   * JSONB que FormTemplate.sections (backwards-compat con el editor
   * Fase 2). NOT contiene `applicableTo` — cada subplantilla ya está
   * implícitamente asociada a un único relationType.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  sections: any;

  /**
   * Peso de esta subplantilla en el score final del ciclo, en rango
   * [0.000, 1.000]. La suma de pesos de todas las subplantillas activas
   * de un mismo padre debe ser 1.0 (validado en el service).
   *
   * Defaults sugeridos por cycle type al auto-crear:
   *   - 90:  manager 0.7, self 0.3
   *   - 180: manager 0.45, self 0.25, peer 0.30
   *   - 270: manager 0.35, self 0.20, peer 0.20, direct_report 0.25
   *   - 360: manager 0.30, self 0.20, peer 0.25, direct_report 0.25
   */
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 3,
    default: 0,
  })
  weight: number;

  /**
   * Orden de visualización en el editor (tabs ordenados). Default
   * estable: self → manager → peer → direct_report → external.
   */
  @Column({ type: 'int', name: 'display_order', default: 0 })
  displayOrder: number;

  /**
   * Si está en false, la subplantilla NO se muestra a evaluadores ni
   * cuenta en el cálculo. Útil para "deshabilitar peer evaluation" sin
   * borrar las preguntas configuradas.
   */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
