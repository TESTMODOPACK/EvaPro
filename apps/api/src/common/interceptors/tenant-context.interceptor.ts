import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // Si hay un usuario autenticado con tenant_id, lo configuramos en la sesión de base de datos
    if (user && user.tenantId) {
      await this.dataSource.query('SET LOCAL app.current_tenant_id = $1', [user.tenantId]);
    } else {
      // Por defecto para requests no autenticados o rutas públicas
      await this.dataSource.query('SET LOCAL app.current_tenant_id = $1', ['']);
    }

    return next.handle();
  }
}
