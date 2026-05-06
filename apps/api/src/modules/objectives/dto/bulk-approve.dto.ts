import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * DTO para POST /objectives/bulk-approve (T4.1).
 *
 * Cap de 100 ids por request — evita batches gigantes que comprometan
 * el response time o memoria. La UI hoy permite seleccionar todos los
 * pendientes en pantalla (típicamente <50). Si un cliente necesita más,
 * debe paginar el batch.
 */
export class BulkApproveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids: string[];
}
