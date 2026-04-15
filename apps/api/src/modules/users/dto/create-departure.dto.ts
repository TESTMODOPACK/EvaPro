import { DepartureType, DepartureReasonCategory } from '../entities/user-departure.entity';

export class CreateDepartureDto {
  departureType: DepartureType;
  departureDate: string; // ISO date
  isVoluntary: boolean;
  reasonCategory?: DepartureReasonCategory;
  reasonDetail?: string;
  wouldRehire?: boolean | null;
  /**
   * (Opcional) id del nuevo manager al cual reasignar los reportes directos
   * del usuario que se está desvinculando. Si se omite, sus reportes quedan
   * con managerId = null (sin jefatura hasta nueva asignación manual).
   */
  reassignToManagerId?: string | null;
}
