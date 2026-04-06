import { MovementType } from '../entities/user-movement.entity';

export class CreateMovementDto {
  movementType: MovementType;
  effectiveDate: string; // ISO date
  fromDepartment?: string;
  toDepartment?: string;
  fromPosition?: string;
  toPosition?: string;
  reason?: string;
}
