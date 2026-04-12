/**
 * paginated-response.ts — Formato estandar de respuesta paginada y helper
 * para ejecutar paginacion sobre un QueryBuilder de TypeORM.
 *
 * Uso en un service:
 *
 *   import { paginate, PaginatedResponse } from '../../common/dto/paginated-response';
 *
 *   async findAll(tenantId: string, pagination: PaginationDto): Promise<PaginatedResponse<Entity>> {
 *     const qb = this.repo.createQueryBuilder('e')
 *       .where('e.tenantId = :tenantId', { tenantId });
 *     return paginate(qb, pagination, {
 *       allowedSortFields: ['createdAt', 'name', 'status'],
 *       defaultSort: 'createdAt',
 *     });
 *   }
 *
 * El helper:
 * 1. Aplica .skip() + .take() segun page/limit
 * 2. Aplica .orderBy() si sortBy esta en la whitelist
 * 3. Ejecuta .getManyAndCount() (1 query con COUNT OVER)
 * 4. Devuelve { data, meta } con toda la info de paginacion
 *
 * El meta incluye `hasNext` y `hasPrev` para que el frontend sepa si
 * mostrar boton "Siguiente" / "Anterior" sin calcular.
 */
import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { PaginationDto, DEFAULT_LIMIT, MAX_LIMIT } from './pagination.dto';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginateOptions {
  /** Lista blanca de campos por los que se puede ordenar. Si el cliente
   *  manda un sortBy que no esta en la lista, se ignora y se usa el
   *  defaultSort. Previene exposicion de columnas internas. */
  allowedSortFields?: string[];
  /** Campo de ordenamiento por defecto si el cliente no manda sortBy.
   *  Default: 'createdAt'. */
  defaultSort?: string;
  /** Alias de la entidad en el QueryBuilder (ej: 'e' si hiciste
   *  createQueryBuilder('e')). Default: detecta automaticamente del QB. */
  alias?: string;
}

/**
 * Ejecuta paginacion sobre un SelectQueryBuilder ya configurado con
 * filtros WHERE pero sin .skip/.take/.orderBy.
 *
 * Retorna un PaginatedResponse<T> listo para devolver al controller.
 */
export async function paginate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  pagination: PaginationDto,
  options: PaginateOptions = {},
): Promise<PaginatedResponse<T>> {
  const page = Math.max(1, pagination.page ?? 1);
  const limit = Math.min(Math.max(1, pagination.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  // ─── Sorting ───────────────────────────────────────────────────────
  const alias = options.alias || qb.alias;
  const defaultSort = options.defaultSort || 'createdAt';
  const allowedFields = options.allowedSortFields;
  const sortOrder = (pagination.sortOrder || 'DESC').toUpperCase() as 'ASC' | 'DESC';

  let sortField = pagination.sortBy || defaultSort;
  // Validar contra whitelist si existe
  if (allowedFields && allowedFields.length > 0 && !allowedFields.includes(sortField)) {
    sortField = defaultSort;
  }
  // Construir el campo completo con alias para evitar ambiguedad en JOINs
  const sortColumn = sortField.includes('.') ? sortField : `${alias}.${sortField}`;

  // ─── Paginar + contar en 1 query ──────────────────────────────────
  qb.orderBy(sortColumn, sortOrder)
    .skip((page - 1) * limit)
    .take(limit);

  const [data, total] = await qb.getManyAndCount();

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}
