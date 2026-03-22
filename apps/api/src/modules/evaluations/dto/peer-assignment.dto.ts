import { IsArray, IsEnum, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RelationType } from '../entities/evaluation-assignment.entity';

export class AddPeerAssignmentDto {
  @IsUUID()
  evaluateeId: string;

  @IsUUID()
  evaluatorId: string;

  @IsEnum(RelationType)
  @IsOptional()
  relationType?: RelationType;
}

export class BulkPeerAssignmentDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPeerAssignmentDto)
  assignments: AddPeerAssignmentDto[];
}
