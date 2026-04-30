/**
 * UserTransferredEvent — S2 Sprint 2.
 *
 * Emitido por `UsersService.transferUser()` cuando un usuario cambia de
 * area (departamento, cargo, manager). Lo escuchan listeners en otros
 * modulos para ejecutar la cascada (cancelar/reasignar evaluaciones,
 * PDI, check-ins, notificar al nuevo manager, etc).
 *
 * Diseno:
 * - El evento es FIRE-AND-FORGET desde la perspectiva del emisor — los
 *   listeners corren async post-commit del transferUser. Si un listener
 *   falla, NO debe revertir el transfer (la dotacion ya cambio en `users`,
 *   no podemos rolar atras todo). Cada listener loguea su propio error.
 *
 * - El payload trae TANTO los IDs PREVIOS como los NUEVOS para que cada
 *   listener pueda hacer queries por viejo/nuevo manager o dept sin
 *   refetch. `effectiveDate` viene como string YYYY-MM-DD.
 *
 * - `triggerSource` distingue:
 *   * `recruitment_hire`: disparado por hireCandidate (S1 cierre selección)
 *   * `manual`: admin edita user en /dashboard/usuarios o /mantenedores
 *   * Otros que se agreguen en futuros sprints (ej. `org_restructure`)
 *
 * - `cascadePolicy` permite a quien dispara controlar el comportamiento
 *   del listener de evaluaciones para CICLOS ACTIVOS donde el user es
 *   evaluatee:
 *   * `auto_replace`: reemplaza evaluador automaticamente (default si
 *     cycle.settings.cascadeOnTransfer === 'auto_replace')
 *   * `freeze`: no toca nada — el ciclo termina con el evaluador snapshot
 *   * `manual`: marca con flag para que el admin decida (default)
 *
 * Por defecto cascadePolicy = `manual` cuando no se especifica.
 */
export const USER_TRANSFERRED_EVENT = 'user.transferred';

export type CascadePolicy = 'auto_replace' | 'freeze' | 'manual';

export class UserTransferredEvent {
  constructor(
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly effectiveDate: string, // YYYY-MM-DD
    public readonly previous: {
      department: string | null;
      departmentId: string | null;
      position: string | null;
      positionId: string | null;
      managerId: string | null;
      hierarchyLevel: number | null;
    },
    public readonly current: {
      department: string | null;
      departmentId: string | null;
      position: string | null;
      positionId: string | null;
      managerId: string | null;
      hierarchyLevel: number | null;
    },
    public readonly triggerSource: 'recruitment_hire' | 'manual' | 'org_restructure',
    public readonly triggeredByUserId: string,
    public readonly cascadePolicy: CascadePolicy = 'manual',
    public readonly reason: string | null = null,
  ) {}

  /**
   * Helper: ¿hubo cambio de manager? Listeners de PDI / meetings / etc
   * lo usan para decidir si reaccionar (no quieren disparar trabajo si
   * solo cambio el cargo dentro del mismo dept con mismo jefe).
   */
  hasManagerChanged(): boolean {
    return this.previous.managerId !== this.current.managerId;
  }

  /** Helper: cambio de departamento (sin importar otros campos). */
  hasDepartmentChanged(): boolean {
    return this.previous.departmentId !== this.current.departmentId
      || this.previous.department !== this.current.department;
  }
}
