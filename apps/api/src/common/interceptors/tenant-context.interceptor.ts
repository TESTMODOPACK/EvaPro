import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // super_admin operates across all tenants — skip tenant context
    if (user && user.role === 'super_admin') {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', '', true)`,
      );
      return next.handle();
    }

    if (user && user.tenantId && UUID_REGEX.test(user.tenantId)) {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [user.tenantId],
      );
    } else {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', '', true)`,
      );
    }

    return next.handle();
  }
}
