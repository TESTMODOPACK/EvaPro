# Instructivo: Deploy y Pruebas — Fase 1 MVP EvaPro

## Resumen de cambios

La Fase 1 incluye nuevas tablas en la base de datos, nuevos módulos en el API y todas las páginas del frontend conectadas al API real. El deploy requiere **recrear las tablas** (schema-sync) porque se eliminó la entidad `evaluations` y se agregaron 5 tablas nuevas.

---

## 1. Push a GitHub

```bash
git push origin main
```

Esto disparará el deploy automático en Render (API) y Netlify (Frontend).

---

## 2. Verificar deploy en Render (API)

### 2.1 El build command en `render.yaml` ejecuta:

```
pnpm install → db:migrate:prod → db:seed → build
```

- `db:migrate:prod` **borra y recrea todas las tablas** (schema-sync.ts)
- `db:seed` crea el tenant demo + admin + manager + 3 employees + template

### 2.2 Agregar variable de entorno (opcional para emails)

En el dashboard de Render → tu servicio `ascenda-api` → Environment:

| Variable | Valor | Requerida |
|----------|-------|-----------|
| `RESEND_API_KEY` | Tu API key de resend.com | Opcional — sin ella, los emails se logean en consola |

Las demás variables (`DATABASE_URL`, `JWT_SECRET`, `PORT`, etc.) ya están configuradas.

### 2.3 Verificar que el API está corriendo

```
GET https://evaluacion-desempeno-api.onrender.com/
```

Debe responder `"Hello World!"`.

### 2.4 Verificar las nuevas tablas

Puedes verificar desde los logs de Render que el schema-sync y seed fueron exitosos:
```
🗑️  Dropping existing tables (raw SQL)…
✅  Tables dropped.
🔄  Running TypeORM schema synchronization…
✅  Schema synchronization complete.
🌱  Connecting to database for seeding…
✅  Tenant created: Demo Company
✅  Admin created: admin@evapro.demo
✅  Manager created: carlos.lopez@evapro.demo
✅  Employee created: ana.martinez@evapro.demo
...
✅  Default template created: Competencias Generales
```

---

## 3. Verificar deploy en Netlify (Frontend)

### 3.1 Variables de entorno en Netlify

En Netlify → Site settings → Environment variables, verifica:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://evaluacion-desempeno-api.onrender.com` |

> Si no está configurada, el frontend usa el fallback hardcodeado al mismo URL.

### 3.2 Build settings

- Build command: `pnpm run build` (o `npx turbo run build --filter=web`)
- Publish directory: `apps/web/.next`
- Base directory: (raíz del repo o `apps/web`)

---

## 4. Pruebas funcionales paso a paso

### 4.1 Login

1. Ir a tu URL de Netlify (ej: `https://ascenda-performance.netlify.app`)
2. El login automático debería funcionar con las credenciales demo
3. Si el API está despierto, verás redirect al dashboard con datos reales
4. **Credenciales de prueba:**

| Usuario | Email | Password | Rol |
|---------|-------|----------|-----|
| Admin | admin@evapro.demo | EvaPro2026! | tenant_admin |
| Manager | carlos.lopez@evapro.demo | EvaPro2026! | manager |
| Empleada | ana.martinez@evapro.demo | EvaPro2026! | employee |

### 4.2 Dashboard

- Verifica que los KPIs muestran datos reales (inicialmente 0 assignments, 0 cycles)
- La sección "Evaluaciones pendientes" debería decir "Sin evaluaciones pendientes"
- Las acciones rápidas deben funcionar como links

### 4.3 Usuarios

1. Ir a `/dashboard/usuarios`
2. Debe mostrar los 5 usuarios seeded (Admin, Carlos, Ana, Luis, Sandra)
3. **Crear usuario:** Click "Agregar usuario" → llenar formulario → Submit
4. **Eliminar usuario:** Click "Eliminar" en un usuario → confirmar
5. **Importar CSV:** Click "Importar CSV" → pegar este CSV de prueba:

```
email,first_name,last_name,role,department,position,manager_email
pedro.sanchez@evapro.demo,Pedro,Sánchez,manager,Ventas,Sales Manager,admin@evapro.demo
elena.ruiz@evapro.demo,Elena,Ruiz,employee,Marketing,Marketing Analyst,pedro.sanchez@evapro.demo
```

### 4.4 Crear un ciclo de evaluación

1. Ir a `/dashboard/evaluaciones`
2. Click "Nuevo ciclo"
3. **Paso 1:** Nombre: "Evaluación Q1 2026", Descripción: "Primera evaluación"
4. **Paso 2:** Tipo: 180° (autoevaluación + jefatura), Fechas: hoy al próximo mes
5. **Paso 3:** Seleccionar la plantilla "Competencias Generales"
6. **Paso 4:** Revisar y crear
7. Debe redirigir a la lista de ciclos, mostrando el nuevo ciclo en estado "Borrador"

### 4.5 Lanzar el ciclo

1. Click en el ciclo recién creado para ver el detalle
2. Click "Lanzar ciclo" → confirmar
3. El sistema creará automáticamente los assignments:
   - Para cada usuario activo: 1 autoevaluación (self)
   - Para cada usuario con manager: 1 evaluación de jefatura (manager)
4. La tabla de asignaciones debe mostrar todas las evaluaciones creadas
5. El estado del ciclo cambia a "Activo"

### 4.6 Completar una evaluación

1. Logear como un empleado (ej: `ana.martinez@evapro.demo / EvaPro2026!`)
2. Ir al Dashboard → sección "Evaluaciones pendientes" (o `/dashboard/evaluaciones`)
3. En el detalle del ciclo activo, buscar tu asignación y click para responder
4. Completar el formulario:
   - Preguntas de escala (1-5): seleccionar valores
   - Preguntas de texto: escribir respuestas
5. El autosave guarda cada 30 segundos (indicador "Guardando...")
6. Click "Enviar evaluación" → confirmar
7. La evaluación queda marcada como completada (no se puede editar)

### 4.7 Ver reportes

1. Logear como admin
2. Ir a `/dashboard/reportes`
3. Seleccionar el ciclo en el dropdown
4. Verificar que muestra métricas reales (puntaje promedio, completadas, etc.)
5. Click "Exportar CSV" para descargar los resultados

### 4.8 Ajustes

1. Ir a `/dashboard/ajustes`
2. Verificar que muestra email y rol del usuario actual
3. Editar nombre y posición → Guardar
4. Debe mostrar "Cambios guardados"

### 4.9 Sidebar según rol

- **Como tenant_admin:** ve Dashboard, Evaluaciones, Usuarios, Reportes, Ajustes
- **Como manager:** ve Dashboard, Evaluaciones, Usuarios, Reportes, Ajustes
- **Como employee:** ve Dashboard, Evaluaciones, Reportes, Ajustes (sin Usuarios)
- "Organizaciones" solo visible para `super_admin`

---

## 5. Pruebas con cURL (API directa)

Si prefieres probar el API directamente:

```bash
# URL base
API=https://evaluacion-desempeno-api.onrender.com

# 1. Login
TOKEN=$(curl -s -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@evapro.demo","password":"EvaPro2026!"}' \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

echo "Token: $TOKEN"

# 2. Ver usuarios
curl -s $API/users -H "Authorization: Bearer $TOKEN" | head -c 500

# 3. Ver mi perfil
curl -s $API/users/me -H "Authorization: Bearer $TOKEN"

# 4. Listar plantillas
curl -s $API/templates -H "Authorization: Bearer $TOKEN"

# 5. Crear un ciclo
curl -s -X POST $API/evaluation-cycles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Q1 2026",
    "type": "180",
    "startDate": "2026-03-01",
    "endDate": "2026-04-30",
    "templateId": "TEMPLATE_ID_AQUI"
  }'

# 6. Lanzar el ciclo (reemplazar CYCLE_ID)
curl -s -X POST $API/evaluation-cycles/CYCLE_ID/launch \
  -H "Authorization: Bearer $TOKEN"

# 7. Ver mis evaluaciones pendientes
curl -s $API/evaluations/pending -H "Authorization: Bearer $TOKEN"

# 8. Dashboard stats
curl -s $API/dashboard/stats -H "Authorization: Bearer $TOKEN"
```

---

## 6. Troubleshooting

| Problema | Causa probable | Solución |
|----------|---------------|----------|
| API responde 503 | Render en cold start (plan gratuito) | Esperar ~30s, el primer request despierta el servicio |
| Login falla con 401 | Tablas no recreadas o seed no corrió | Verificar logs de Render, re-deploy manual si es necesario |
| Frontend muestra datos demo | API no accesible | Verificar que `NEXT_PUBLIC_API_URL` apunta al API correcto |
| "Ciclo debe tener plantilla" | No se seleccionó template al crear | Asegurar que el seed creó la plantilla "Competencias Generales" |
| Error "relation does not exist" | Schema-sync no corrió | En Render: Manual Deploy → Clear build cache & deploy |
| CORS error en browser | `FRONTEND_URL` no incluye tu dominio Netlify | Agregar tu URL de Netlify en la variable `FRONTEND_URL` de Render |
| Evaluaciones pendientes vacías | No se ha lanzado ningún ciclo | Crear un ciclo con template y lanzarlo primero |

---

## 7. Orden recomendado de prueba

1. Push → esperar deploys
2. Verificar API health (`GET /`)
3. Login como admin
4. Ver usuarios (deben aparecer los 5 seeded)
5. Crear un ciclo 180° con plantilla
6. Lanzar el ciclo
7. Verificar assignments creados
8. Login como empleado → completar evaluación
9. Login como admin → ver reportes del ciclo
10. Exportar CSV
