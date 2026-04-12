# Migraciones de Base de Datos — Eva360

## Resumen

Eva360 usa **TypeORM migrations** para gestionar cambios de schema en la base de datos PostgreSQL. Cada cambio (agregar columna, crear tabla, agregar indice) se registra en un archivo de migracion versionado y reversible.

**Regla #1:** NUNCA modificar el schema directamente con SQL en produccion. Siempre crear una migracion.

**Regla #2:** `synchronize: true` esta DESACTIVADO en produccion. Solo en dev se permite para iteracion rapida.

---

## Comandos

Desde la carpeta `apps/api/`:

```bash
# Generar una migracion automatica comparando las entidades TS con la BD
npm run migration:generate -- src/database/migrations/NombreDeLaMigracion

# Ejecutar todas las migraciones pendientes
npm run migration:run

# Revertir la ultima migracion ejecutada
npm run migration:revert

# Ver cuales migraciones estan ejecutadas y cuales pendientes
npm run migration:show
```

## Flujo para agregar un cambio de schema

### 1. Modificar la entidad TypeScript

```typescript
// En el archivo de la entidad (ej: user.entity.ts)
@Column({ type: 'varchar', length: 100, nullable: true, name: 'phone_number' })
phoneNumber: string | null;
```

### 2. Generar la migracion

```bash
npm run migration:generate -- src/database/migrations/AddPhoneToUsers
```

TypeORM compara el schema actual de la BD con las entidades TS y genera un archivo con el SQL necesario:

```
src/database/migrations/1713000000000-AddPhoneToUsers.ts
```

### 3. Revisar el archivo generado

Abrir el archivo y verificar que el SQL es correcto. TypeORM a veces genera migraciones destructivas (DROP COLUMN) si renombraste un campo — revisar siempre antes de ejecutar.

### 4. Ejecutar en dev

```bash
npm run migration:run
```

### 5. Ejecutar en produccion (Render)

En Render Shell:
```bash
cd /opt/render/project/src
npx typeorm-ts-node-commonjs migration:run -d apps/api/src/database/datasource.ts
```

### 6. Ejecutar en produccion (Hostinger Docker)

```bash
docker compose exec api npx typeorm-ts-node-commonjs migration:run -d src/database/datasource.ts
```

O para usar el archivo compilado:
```bash
docker compose exec api node -e "
  const ds = require('./dist/database/datasource').default;
  ds.initialize().then(() => ds.runMigrations()).then(() => { console.log('OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"
```

## Rollback

Si una migracion rompe algo:

```bash
npm run migration:revert
```

Esto ejecuta el metodo `down()` de la ultima migracion, deshaciendo los cambios.

## Estructura de archivos

```
apps/api/src/database/
  datasource.ts          ← Config standalone para el CLI de TypeORM
  migrations/
    .gitkeep
    1713000000000-AddPhoneToUsers.ts  ← Ejemplo de migracion
  sql/
    2026-04-10-indexes-and-status.sql ← SQL ad-hoc legacy (pre-migraciones)
    2026-04-11-phase0-indexes.sql     ← SQL ad-hoc legacy (pre-migraciones)
```

Los archivos `.sql` en `sql/` son migraciones ad-hoc anteriores al sistema de migraciones formal. Ya fueron aplicados en produccion. No tocar.

## Notas importantes

- **DATABASE_URL** debe estar definido para que el CLI funcione.
- En Docker, el CLI corre dentro del container (`docker compose exec api ...`).
- Las migraciones se registran en la tabla `migrations` de PostgreSQL. No borrar esa tabla.
- Si la BD esta vacia (primer deploy), `migration:run` aplica TODAS las migraciones en orden cronologico.
- `migration:generate` requiere una BD corriendo con el schema actual para poder comparar.
