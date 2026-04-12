/**
 * pagination.dto.ts — DTO reutilizable para paginacion en todos los
 * endpoints de listado de EvaPro.
 *
 * Uso en un controller:
 *
 *   @Get()
 *   list(@Query() pagination: PaginationDto) {
 *     return this.service.findAll(tenantId, pagination);
 *   }
 *
 * El ValidationPipe global transforma los query params (strings) a los
 * tipos correctos (numbers) via `transform: true` + `@Type(() => Number)`.
 *
 * Defaults: page=1, limit=50, sortOrder=DESC. El caller puede override
 * cualquier campo via query params (?page=2&limit=20&sortBy=name&sortOrder=ASC).
 *
 * `MAX_LIMIT` (200) es un tope duro — sin importar lo que el cliente
 * pida, nunca devolvemos mas de 200 registros por pagina. Esto previene
 * OOM en tenants con miles de filas.
 */
import { IsOptional, IsInt, Min, Max, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  sortOrder?: 'ASC' | 'DESC' | 'asc' | 'desc' = 'DESC';
}
