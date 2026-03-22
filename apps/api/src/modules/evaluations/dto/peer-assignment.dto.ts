import { IsArray, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AddPeerAssignmentDto {
  @IsUUID()
  evaluateeId: string;

  @IsUUID()
  evaluatorId: string;
}

export class BulkPeerAssignmentDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPeerAssignmentDto)
  assignments: AddPeerAssignmentDto[];
}
