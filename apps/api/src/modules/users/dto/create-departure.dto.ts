import { DepartureType, DepartureReasonCategory } from '../entities/user-departure.entity';

export class CreateDepartureDto {
  departureType: DepartureType;
  departureDate: string; // ISO date
  isVoluntary: boolean;
  reasonCategory?: DepartureReasonCategory;
  reasonDetail?: string;
  wouldRehire?: boolean | null;
}
