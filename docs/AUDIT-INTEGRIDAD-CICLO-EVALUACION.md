# 📘 ESPECIFICACIÓN DE REGLAS DE NEGOCIO — Integridad del Ciclo de Evaluación

**Sistema:** eva360 (SaaS Multi-Empresa de Performance Management)
**Auditor:** Lead Software Architect & PO Senior HR Tech
**Fecha:** 2026-04-28
**Versión:** 1.0
**Estado:** Draft for review

**Scope:** Auditoría exhaustiva de 4 dimensiones críticas:
- **A.** Mapeo automático de roles (organigrama → relaciones de evaluación)
- **B.** Motor de cálculo y ponderaciones
- **C.** Integridad y snapshotting del estado del ciclo
- **D.** Consolidación de resultados (agregación de respuestas)

**Convenciones del documento:**
- **F-X.Y** = Finding (hallazgo)
- **BR-X.Y.N** = Business Rule (regla de negocio numerada)
- **UC-X.Y.N** = Use Case (caso de uso)
- **EC-X.Y.N** = Edge Case
- **MV-X.Y.N** = Métrica/Validación de éxito

**Severidad de findings:**
- 🟥 **Crítico** — riesgo de integridad de datos o legal
- 🟧 **Alto** — afecta calidad de resultados o experiencia
- 🟨 **Medio** — limitación funcional resoluble
- 🟩 **OK** — implementación correcta, sin acción

**Verdict global:**
> **Sistema funcional pero con riesgos de integridad estructural — apto para empresas <200 personas con baja rotación, requiere endurecimiento crítico (Dimensión C) antes de escalar a clientes mid-market o regulados.**

---

## 📑 ÍNDICE

- [Dimensión A — Mapeo Automático de Roles](#dimensión-a--mapeo-automático-de-roles)
  - [F-A.1 — Redistribución de pesos sin manager](#-f-a1--redistribución-de-pesos-cuando-un-rol-no-aplica-al-evaluado)
  - [F-A.2 — Min peer count hardcoded](#-f-a2--mínimo-de-peers-hardcoded)
  - [F-A.3 — Restricción "mismo departamento"](#-f-a3--restricción-mismo-departamento-muy-rígida)
  - [F-A.4 — Sin matrix reporting](#-f-a4--falta-soporte-para-matrix-reporting-dotted-line-managers)
  - [F-A.5 — Manager inactivo OK](#-f-a5--detección-de-manager-inactivo-bien-implementada)
- [Dimensión B — Motor de Cálculo y Ponderaciones](#dimensión-b--motor-de-cálculo-y-ponderaciones)
  - [F-B.1 — Override por ciclo OK](#-f-b1--override-por-ciclo-sí-existe-fase-3)
  - [F-B.2 — Redistribución implícita](#-f-b2--redistribución-implícita-sin-transparencia)
  - [F-B.3 — Sin umbral mínimo respuestas](#-f-b3--sin-umbral-mínimo-de-respuestas-para-activar-peso)
  - [F-B.4 — Sin pesos por sección](#-f-b4--sin-pesos-por-seccióncompetencia)
  - [F-B.5 — Validación 1.0 OK](#-f-b5--validación-de-suma--10-ok)
- [Dimensión C — Integridad y Snapshotting](#dimensión-c--integridad-y-snapshotting--crítico)
  - [F-C.1 — NO snapshot organigrama](#-f-c1--no-hay-snapshot-del-organigrama-al-lanzar-ciclo)
  - [F-C.2 — NO snapshot template](#-f-c2--no-hay-snapshot-del-template-ni-de-los-pesos-al-lanzar)
  - [F-C.4 — Cascade parcial en deactivate](#-f-c4--cascade-en-deactivate-user-es-parcial)
- [Dimensión D — Consolidación de Resultados](#dimensión-d--consolidación-de-resultados)
  - [F-D.1 — Sin manejo de outliers](#-f-d1--sin-manejo-de-outliers)
  - [F-D.4 — Sin reliability metrics](#-f-d4--sin-métricas-de-inter-rater-reliability)
  - [F-D.3 — Rater bias normalization (BACKLOG)](#-f-d3--rater-bias-normalization-backlog)
- [Roadmap y prioridades](#-roadmap-recomendado)

---

## DIMENSIÓN A · MAPEO AUTOMÁTICO DE ROLES

### 🟧 F-A.1 — Redistribución de pesos cuando un rol no aplica al evaluado

#### Estado actual

- `evaluations.service.ts:670-684` — al detectar `evaluatee.managerId === null`, se lanza `EXCEPTION: NO_MANAGER` y se **omite la creación del assignment de manager**.
- `cycle.settings.weights` y `formSubTemplate.weight` **siguen apuntando** a un peso de manager (ej. 30%).
- En `reports.service.ts:1290-1304`, el cálculo divide `weightedSum / weightTotal` donde `weightTotal` solo incluye roles que respondieron → **redistribución matemática implícita pero sin transparencia ni opción de configuración**.

#### Riesgo

- El score del CEO (sin manager) parece "comparable" al de un Sr. Manager (con manager) cuando matemáticamente fueron calculados sobre bases distintas.
- En un proceso de calibración, comparar dos personas con metodologías de cálculo distintas (sin que el calibrador lo sepa) es éticamente cuestionable.

#### Reglas de negocio (BR-A.1)

- **BR-A.1.1** — Si un evaluado carece de un rol incluido en `cycle.allowedRelations`, el sistema **debe** ofrecer al admin **3 estrategias** explícitas en el wizard de creación del ciclo:
  - `EXCLUDE_EVALUATEE` — el evaluado se excluye del ciclo (no se le aplica este tipo de evaluación).
  - `REDISTRIBUTE_PROPORTIONAL` — el peso del rol faltante se redistribuye proporcionalmente entre los roles activos. (comportamiento actual implícito).
  - `MANUAL_OVERRIDE` — el admin asigna manualmente otro evaluador para suplir ese rol (ej. Junta Directiva como "manager" del CEO).
- **BR-A.1.2** — La estrategia se persiste en `cycle.settings.missingRoleStrategy` (string enum) y aplica a TODOS los evaluados de ese ciclo. Para casos individuales se usa `MANUAL_OVERRIDE`.
- **BR-A.1.3** — Si el admin elige `REDISTRIBUTE_PROPORTIONAL`, el sistema debe **persistir el `effectiveWeights` por evaluado** en una tabla `cycle_evaluatee_weights` para garantizar trazabilidad histórica.
- **BR-A.1.4** — Cualquier evaluado con redistribución debe llevar una bandera visible (`hasRedistributedWeights: true`) en su perfil de ciclo y en todos los reports.
- **BR-A.1.5** — La estrategia default es `REDISTRIBUTE_PROPORTIONAL` (mantiene backwards-compat).

#### Casos de uso

- **UC-A.1.1 — CEO en ciclo 360°:** Pedro (CEO, `managerId=null`) es incluido en ciclo 360° con pesos `{manager:30, self:20, peer:25, dr:25}`. Admin elige `REDISTRIBUTE_PROPORTIONAL`. Sistema calcula `effectiveWeights` para Pedro: `{self: 0.286, peer: 0.357, dr: 0.357}` (redistribuye 30% de manager: 8.57% a cada rol activo). Persiste en `cycle_evaluatee_weights`.
- **UC-A.1.2 — Empleado nuevo sin pares en ciclo 180°:** Ana (recién contratada, único en su depto) no tiene pares. Admin eligió `MANUAL_OVERRIDE`: asigna manualmente a Ana 2 pares de un depto adyacente. Sistema crea assignments excepcionales con flag `isException: true`.
- **UC-A.1.3 — Director General en 270°:** Carlos (sin manager) en ciclo 270° con `EXCLUDE_EVALUATEE`. Carlos NO recibe evaluación 270°. Sistema crea un ciclo paralelo o le asigna un 90° (auto + comité).

#### Edge cases

- **EC-A.1.1** — Si un evaluado tiene manager_id pero el manager está inactivo → tratar igual que `NO_MANAGER` (aplicar la estrategia configurada).
- **EC-A.1.2** — Si la suma de pesos de roles activos da 0 (ej. 90° con CEO sin manager y self desactivado) → forzar `EXCLUDE_EVALUATEE` con error claro.
- **EC-A.1.3** — Si la estrategia es `MANUAL_OVERRIDE` y el admin no provee asignación manual al lanzar ciclo → bloquear lanzamiento con error explícito por evaluado.

#### Validaciones y métricas

- **MV-A.1.1** — Pre-launch validation: para cada `evaluatee × allowedRelation`, debe existir una de estas 3 condiciones: (a) assignment generado, (b) excepción manejada según estrategia, (c) `EXCLUDE_EVALUATEE` aplicada.
- **MV-A.1.2** — Métrica de éxito: % de ciclos lanzados sin warnings de excepciones no resueltas. Target: 100%.

#### Impacto técnico

- Nueva tabla `cycle_evaluatee_weights (cycle_id, evaluatee_id, effective_weights JSONB, strategy_used VARCHAR)`.
- Nuevo campo `cycle.settings.missingRoleStrategy`.
- Modificar `autoGenerateAssignments` para devolver excepciones agrupadas por evaluado (no por relationType) y proponer estrategia.
- Modificar `reports.service.competencyRadar / selfVsOthers` para leer pesos efectivos desde `cycle_evaluatee_weights` (con fallback al cycle.settings.weights).

---

### 🟨 F-A.2 — Mínimo de peers hardcoded

#### Estado actual

- `evaluations.service.ts:795` — `if (peerCandidates.length < 3)` hardcoded.
- `evaluations.service.ts:977` — al lanzar ciclo, valida `peerCount < 3` para 270°/360°.

#### Reglas de negocio (BR-A.2)

- **BR-A.2.1** — El **mínimo de evaluadores tipo peer** debe ser configurable a nivel **tenant** (default global) y a nivel **ciclo** (override).
- **BR-A.2.2** — El mínimo no puede ser inferior a **2 para mantener anonimato** (reglas estadísticas: con 1 evaluador, su identidad es deducible). Validación hard.
- **BR-A.2.3** — Para tipos `peer` y `direct_report`, si el N reales < N configurado, aplicar BR-A.1 (estrategias de excepción).
- **BR-A.2.4** — La configuración se persiste en:
  - `tenant.settings.minPeerCount` (default 3)
  - `cycle.settings.minPeerCount` (override; null = usa el del tenant)

#### Casos de uso

- **UC-A.2.1 — Startup de 8 personas:** admin configura `tenant.minPeerCount = 2`. Permite ciclos 270° con 2 pares por evaluado.
- **UC-A.2.2 — Empresa enterprise estricta:** `tenant.minPeerCount = 5` para garantizar diversidad. Ciclos requieren 5 pares mínimo.

#### Edge cases

- **EC-A.2.1** — Configurar `minPeerCount = 1` debe rechazarse con HTTP 400 + mensaje "Por anonimato no se permite menos de 2 pares".
- **EC-A.2.2** — Si admin baja `minPeerCount` mid-cycle → no afecta retroactivamente, solo a ciclos nuevos.

#### Validaciones y métricas

- **MV-A.2.1** — `min: 2`, `max: 20` (constraint a nivel DTO).

#### Impacto técnico

- Migration: `tenant.settings.minPeerCount` y `cycle.settings.minPeerCount`.
- Refactor `autoGenerateAssignments` y `launchCycle` para leer config dinámica.

---

### 🟨 F-A.3 — Restricción "mismo departamento" muy rígida

#### Estado actual

- `evaluations.service.ts:741, 791` — `direct_report` y `peer` solo se asignan si `evaluatee.departmentId === candidate.departmentId`.

#### Riesgo

Empresas matriciales, cross-functional teams, o re-orgs activas → muchas excepciones falsas (`MANAGER_DIFF_DEPT`).

#### Reglas de negocio (BR-A.3)

- **BR-A.3.1** — La estrategia de "scoping" para identificar candidatos de peer/direct_report debe ser configurable:
  - `SAME_DEPARTMENT` (actual; default)
  - `MANAGER_TREE` — incluye todos los miembros del subárbol del mismo manager (independiente de depto)
  - `SAME_HIERARCHY_LEVEL` — incluye todos los users con `hierarchyLevel ± 1` del evaluado (independiente de depto)
  - `ALL_ACTIVE` — todos los users activos del tenant (último recurso)
- **BR-A.3.2** — La configuración es por **ciclo**: `cycle.settings.peerScopingStrategy` y `cycle.settings.directReportScopingStrategy`.
- **BR-A.3.3** — Si la estrategia produce >20 candidatos, el sistema **debe** refinar tomando los más cercanos por: (a) hierarchyLevel proximity, (b) departmentId match (preferencia), (c) relación temporal (los que comparten manager hace >6 meses).

#### Casos de uso

- **UC-A.3.1 — Squad ágil:** un equipo cross-functional con 8 personas (1 PM, 2 designers, 3 devs, 2 QAs) repartidos en 4 deptos formales. Admin configura `peerScopingStrategy = MANAGER_TREE`. Sistema asigna pares dentro del mismo squad ignorando depto formal.
- **UC-A.3.2 — Roles únicos:** un Lead Architect que es el único de su tipo. Admin configura `SAME_HIERARCHY_LEVEL` para encontrar pares en otros deptos del mismo nivel.

#### Edge cases

- **EC-A.3.1** — Si la estrategia da 0 candidatos (ej. único manager en su nivel) → cae a la siguiente estrategia o se trata como `INSUFFICIENT_PEERS` (BR-A.1).
- **EC-A.3.2** — `MANAGER_TREE` no debe descender más de 2 niveles (evita listas gigantes de "todos los del depto X").

#### Validaciones y métricas

- **MV-A.3.1** — Cobertura del auto-generate ≥80% (vs ~40% actual con `SAME_DEPARTMENT` en empresas matriciales).

---

### 🟨 F-A.4 — Falta soporte para matrix reporting (dotted-line managers)

#### Estado actual

Entidad `User` solo tiene `managerId` (one-to-one).

#### Riesgo

Empresas con estructura matricial (consultoras, agencias, tech con squads) modelan la relación principal pero pierden la perspectiva del jefe funcional / jefe de proyecto.

#### Reglas de negocio (BR-A.4)

- **BR-A.4.1** — El sistema debe soportar **N managers por user**, distinguiendo:
  - `primaryManagerId` (campo actual; jefe formal de RRHH)
  - `secondaryManagers: string[]` (jefes funcionales/proyecto)
- **BR-A.4.2** — En ciclos 360°/270°, los `secondaryManagers` se asignan como **rol "manager"** con peso compartido del weight de manager (ej. si peso manager = 30%, dividirlo: primary 20% + secondary 10%).
- **BR-A.4.3** — La configuración del split es a nivel `cycle.settings.secondaryManagerWeightShare` (default 0.33 = 1/3 del peso de manager va a secondary, 2/3 al primary).
- **BR-A.4.4** — Si el secondary manager está en otro depto, la regla `MANAGER_DIFF_DEPT` debe ser un **soft warning** (no bloquea), no exception.
- **BR-A.4.5** — En reports, `byRelation.manager` debe poder desagregarse: `manager_primary` y `manager_secondary` con sus respectivos scores.

#### Casos de uso

- **UC-A.4.1 — Sr. Engineer en consultora:** Juan es Sr. Engineer con `primaryManagerId = Tech Lead Sofía` y `secondaryManagers = [PM Pablo]`. Ciclo 360°. Pesos manager 30% → Sofía 20%, Pablo 10%.
- **UC-A.4.2 — Auditor que rota proyectos:** Marta es auditora con primary = Senior Auditor, pero ha trabajado en 3 proyectos en el último año. Admin agrega los 3 PMs como `secondaryManagers`. Cada uno aporta 3.33% del peso.

#### Edge cases

- **EC-A.4.1** — Si user tiene >5 secondary managers → cap a 5 (UI advierte).
- **EC-A.4.2** — Si el secondary manager está en el mismo depto que el primary → tratar como peer en lugar de manager (evita doble conteo).
- **EC-A.4.3** — Cycle 90° (solo manager) — usar **solo primary** (no asignar secondary). Justificación: 90° busca rapidez/simplicidad.

#### Validaciones y métricas

- **MV-A.4.1** — `secondaryManagers.length ≤ 5`.
- **MV-A.4.2** — `primaryManagerId NOT IN secondaryManagers` (no duplicar).
- **MV-A.4.3** — `userId NOT IN secondaryManagers` (no auto-referencia).

#### Impacto técnico

- Migration: agregar columna `users.secondary_managers UUID[]` o tabla separada `user_secondary_managers (user_id, manager_id, role_label)`.
- Refactor `autoGenerateAssignments` para incluir secondary managers como `relationType: MANAGER`.
- Refactor `reports.service.competencyRadar` para split (opcional, default = aggregate).

---

### 🟩 F-A.5 — Detección de manager inactivo bien implementada

La excepción `MANAGER_INACTIVE` (Fase 1) detecta correctamente cuando `evaluatee.managerId` apunta a un user con `is_active=false`.

**Sin acción requerida.**

---

## DIMENSIÓN B · MOTOR DE CÁLCULO Y PONDERACIONES

### 🟩 F-B.1 — Override por ciclo SÍ existe (Fase 3)

**Archivo:** `reports.service.ts:1146-1158`, frontend `evaluaciones/nuevo/page.tsx`

La cadena de prioridad es:
```
cycle.settings.weights[role]  →  formSubTemplate.weight[role]  →  0
```

Configurable por campaña: ✅ implementado en el wizard de crear ciclo (Fase 3 - Lote feature).

**Sin acción requerida.**

---

### 🟧 F-B.2 — Redistribución implícita sin transparencia

#### Estado actual

- `reports.service.ts:1292-1304` — calcula `weightedSum / weightTotal` donde weightTotal solo incluye roles que respondieron.
- El output retorna `byRelation` y `overall` pero **no expone** los pesos efectivos usados.

#### Reglas de negocio (BR-B.2)

- **BR-B.2.1** — Todos los reports cuantitativos (`competencyRadar`, `selfVsOthers`, `competencyHeatmap`) deben **exponer en el output**:
  - `configuredWeights` — los pesos definidos en cycle.settings o sub_template
  - `effectiveWeights` — los pesos realmente usados (post-redistribución)
  - `rolesWithoutData: string[]` — roles que no contribuyeron
  - `redistributionApplied: boolean` — flag binario
- **BR-B.2.2** — El frontend debe mostrar un indicador visible cuando `redistributionApplied === true`:
  - Tooltip ⓘ "Pesos redistribuidos por falta de respuestas de [roles]. Peso original de [role] = X%, redistribuido entre los roles activos."
  - Badge "Pesos efectivos diferentes a los configurados".
- **BR-B.2.3** — En el export PDF/Excel del report, incluir una sección "Notas metodológicas" que documente la redistribución.

#### Casos de uso

- **UC-B.2.1 — Manager no respondió:** Pedro tenía manager asignado pero el manager no completó la evaluación antes del cierre. El radar de Pedro debe mostrar "⚠ Sin datos de jefe directo. Pesos redistribuidos." y mostrar effectiveWeights.
- **UC-B.2.2 — CEO sin manager (línea con BR-A.1):** Pedro (CEO) tiene `MANUAL_OVERRIDE` excluyendo manager. Effective weights mostrados son de los 3 roles restantes redistribuidos.

#### Edge cases

- **EC-B.2.1** — Si TODOS los roles excepto self respondieron 0 datos → `overall = selfScore` con flag "Score basado solo en autoevaluación, baja confiabilidad".
- **EC-B.2.2** — Si NINGÚN rol respondió → `overall = null`, mensaje "Sin evaluaciones registradas".

#### Validaciones y métricas

- **MV-B.2.1** — % de reports con `redistributionApplied: true` debe ser <10% en empresas con >100 personas (signo de problema operativo si es mayor).

---

### 🟧 F-B.3 — Sin umbral mínimo de respuestas para activar peso

#### Estado actual

`reports.service.ts:1283-1287` — `if (data.count === 0) continue` solo omite si NO hay ninguna respuesta. Si hay 1 sola, cuenta con peso completo.

#### Riesgo

- 1 par de 5 esperados respondiendo determinaría el 25% del score con baja confiabilidad estadística.
- Sesgo muestral grande en empresas chicas o con baja participación.

#### Reglas de negocio (BR-B.3)

- **BR-B.3.1** — El sistema debe calcular un **factor de confianza por rol** basado en `responseRatio = respondedCount / assignedCount`:
  - Si `responseRatio ≥ 0.8` (umbral default) → peso completo aplicado.
  - Si `0.4 ≤ responseRatio < 0.8` → peso × responseRatio (atenuado).
  - Si `responseRatio < 0.4` → peso × 0.5 (mínimo) + warning visible.
- **BR-B.3.2** — El umbral `responseRatioThreshold` y la fórmula de penalización son configurables a nivel cycle:
  - `cycle.settings.minResponseRatio` (default 0.6)
  - `cycle.settings.responseRatioStrategy` enum: `STRICT` (todo o nada, < umbral = excluir rol), `LINEAR` (atenuación proporcional default), `NONE` (comportamiento actual).
- **BR-B.3.3** — En reports, mostrar `responseRatio` por rol y visualmente codificar (verde >80%, amarillo 40-80%, rojo <40%).

#### Casos de uso

- **UC-B.3.1 — Strict mode:** Empresa enterprise. `STRICT` con `minResponseRatio = 0.6`. Si solo 2 de 5 pares respondieron (40%), el rol "peer" se excluye del cálculo y los pesos redistribuyen al resto (aplica BR-A.1).
- **UC-B.3.2 — Linear mode:** Default. 1 de 5 pares respondió (20%). Peso original 25% × 0.5 (penalización min) = 12.5% efectivo. Resto se redistribuye.

#### Edge cases

- **EC-B.3.1** — Si admin configura strategy `NONE` (legacy) → comportamiento actual (sin penalización).
- **EC-B.3.2** — Si responseRatio = 0 (nadie respondió) → siempre excluir, independiente de strategy.

#### Validaciones y métricas

- **MV-B.3.1** — Reliability score por evaluado: weighted average de responseRatios de roles activos. Target empresarial: ≥0.75.

---

### 🟨 F-B.4 — Sin pesos por sección/competencia

#### Estado actual

- El peso es solo a nivel `relationType` × evaluatee.
- Todas las secciones dentro de la sub_template suman al promedio simple.

#### Reglas de negocio (BR-B.4)

- **BR-B.4.1** — Cada `FormSubTemplate.sections[]` debe poder llevar un campo opcional `weight: decimal` (default 1.0 = peso uniforme).
- **BR-B.4.2** — La normalización es a nivel sub: pesos relativos. Ejemplo: si sub tiene 3 secciones con pesos `[2, 1, 1]`, el sistema normaliza a `[0.5, 0.25, 0.25]` (sum=1).
- **BR-B.4.3** — El cálculo del score por sub aplica:
  ```
  subScore = Σ (sectionAvg × sectionWeight) / Σ sectionWeight
  ```
- **BR-B.4.4** — Para reports cross-evaluador (radar), las secciones se agrupan por `competencyId` (igual que actual). Los pesos de sección se promedian entre subs (cada sub puede tener distinto peso para la misma competencia).

#### Casos de uso

- **UC-B.4.1 — Plantilla de Liderazgo:** sub "Manager" con secciones: `[Estrategia: 3, Comunicación: 2, Operaciones: 1]`. Las decisiones estratégicas tienen 3x más peso que las operativas. Dentro de sub Manager, los scores se ponderan así.
- **UC-B.4.2 — Plantilla técnica:** Sub "Self" sin pesos custom (todos = 1) — el admin no se preocupa por priorizar.

#### Edge cases

- **EC-B.4.1** — Si todos los pesos son 0 → considerar todos como 1.0 (default uniforme).
- **EC-B.4.2** — Sección sin scale questions → no aporta al subScore (peso ignorado).

#### Validaciones y métricas

- **MV-B.4.1** — % de plantillas con pesos custom != 1.0 (signo de adopción del feature).

---

### 🟩 F-B.5 — Validación de suma == 1.0 OK

La validación `weights.reduce(sum) === 1.0 ± tolerance` está implementada en `updateWeights` y `saveAllSubTemplates`.

**Sin acción requerida.**

---

## DIMENSIÓN C · INTEGRIDAD Y SNAPSHOTTING — **CRÍTICO**

### 🟥 F-C.1 — NO hay snapshot del organigrama al lanzar ciclo

#### Estado actual

- `evaluation_assignments` tiene solo `(evaluatee_id, evaluator_id, relation_type)`. No captura estado del organigrama al lanzar.
- Reports cruzan responses con `users` actual → si el organigrama cambió, las inferencias son inconsistentes.

#### Riesgo crítico

1. **Trazabilidad perdida:** "¿Por qué María evaluó a Juan?" → la respuesta actual ("María era manager de Juan") solo es válida si los datos no cambiaron.
2. **Reports falsificables:** los promedios "by relation" cruzan con `users.relationType_at_time_of_response` que ya no existe.
3. **Compliance / legal:** en países con leyes de transparencia laboral (España GDPR, Chile Ley 21.643), un evaluador despedido cuyo evaluation persiste como "rolHash desconocido" es vulnerabilidad.

#### Reglas de negocio (BR-C.1)

- **BR-C.1.1** — Al ejecutar `launchCycle`, el sistema **debe persistir** un snapshot del organigrama en una nueva tabla:
  ```sql
  CREATE TABLE cycle_org_snapshots (
    cycle_id UUID NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    primary_manager_id UUID NULL,
    secondary_managers UUID[] NULL,
    department_id UUID NULL,
    department_name VARCHAR(200) NULL,
    hierarchy_level INT NULL,
    role VARCHAR(50) NULL,
    is_active BOOLEAN NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cycle_id, user_id)
  );
  ```
- **BR-C.1.2** — El snapshot incluye **todos los users activos** al momento del launch, no solo los evaluados (necesario para identificar evaluators correctamente).
- **BR-C.1.3** — Reports y validaciones de assignments **deben leer del snapshot** cuando el ciclo está `active|closed|cancelled`. Solo en `draft` se lee del estado actual de `users`.
- **BR-C.1.4** — `evaluation_assignments` debe tener un nuevo campo `relation_basis JSONB` que documenta por qué se creó (ej. `{snapshotManagerId: 'uuid-X', reason: 'auto_generate'}`).
- **BR-C.1.5** — El snapshot es **inmutable**. No se actualiza si cambia el organigrama post-launch. Solo se puede regenerar si se cancela el ciclo y se vuelve a draft (operación reservada a super_admin).
- **BR-C.1.6** — Si admin necesita "actualizar el snapshot" (ej. agregar a un nuevo hire al ciclo activo), debe usar `addEvaluateeToCycle()` que insertará la fila al snapshot con `snapshot_at` actual + bandera `lateAddition: true`.

#### Casos de uso

- **UC-C.1.1 — Manager despedido mid-cycle:** Día 1: ciclo lanzado, María (mgr) evalúa a Juan. Día 15: María renuncia, RRHH la desactiva. Día 30: cierre. Reports muestran "Manager: María (al momento del lanzamiento)" + nota "Evaluadora dejó la empresa el 15/oct" + score sigue contando.
- **UC-C.1.2 — Promoción mid-cycle:** Día 1: ciclo lanzado, Pedro era reporte directo de María. Día 15: Pedro promovido a manager (reporta ahora a Sofía). Día 30: Pedro completó self-evaluation. Reports leen de snapshot → lo siguen tratando como reporte directo de María.
- **UC-C.1.3 — Re-org masivo:** Día 1: ciclo activo con 50 personas. Día 20: empresa hace re-org y cambia 30% de los managerIds. Día 30: cierre. Reports siguen mostrando estructura del Día 1 (snapshot).

#### Edge cases

- **EC-C.1.1** — User agregado al ciclo después del launch (`lateAddition`) → tiene snapshot con `snapshot_at` distinto al resto. Reports muestran badge "agregado tarde".
- **EC-C.1.2** — User eliminado del snapshot (admin lo desincripta del ciclo) → snapshot se preserva con flag `excluded_at TIMESTAMPTZ`.
- **EC-C.1.3** — Si un evaluator ya no existe en `users` (hard delete improbable, pero...) → reports muestran "Evaluador inexistente" sin romper.

#### Validaciones y métricas

- **MV-C.1.1** — Test de regression: ciclo lanzado → cambiar `users.managerId` → verificar que report sigue mostrando la relación original.
- **MV-C.1.2** — Performance: snapshot de 1000 users debe persistirse en <2s.

---

### 🟥 F-C.2 — NO hay snapshot del template ni de los pesos al lanzar

#### Estado actual

- `cycle.template_id` apunta a un template que puede mutar.
- `cycle.settings.weights` puede ser modificado mid-cycle.
- `FormTemplate.versionHistory` (Lote 1) snapshotea internamente la edición pero el ciclo no apunta a una versión específica.

#### Riesgo crítico

- Admin edita la plantilla mid-cycle (agrega/cambia preguntas) → formularios pendientes muestran la nueva versión, completados quedan con datos del antiguo. Mezclas son catastróficas.
- Pesos cambiados mid-cycle alteran reports retroactivamente.

#### Reglas de negocio (BR-C.2)

- **BR-C.2.1** — `evaluation_cycles` debe tener nuevos campos:
  ```sql
  template_version_at_launch INT NULL,
  template_snapshot JSONB NULL,        -- snapshot completo: padre + subs
  weights_at_launch JSONB NULL,        -- copia de cycle.settings.weights al launch
  launched_at TIMESTAMPTZ NULL
  ```
- **BR-C.2.2** — Al ejecutar `launchCycle`:
  1. Incrementar `FormTemplate.version` y push al `versionHistory`.
  2. Copiar el estado COMPLETO del template (parent + sub_templates incluyendo sections, weights, scaleLabels, conditions, options) al campo `cycle.template_snapshot`.
  3. Copiar `cycle.settings.weights` a `cycle.weights_at_launch`.
  4. Setear `template_version_at_launch = template.version`.
  5. Setear `launched_at = NOW()`.
- **BR-C.2.3** — Una vez lanzado el ciclo:
  - El template padre puede seguir editándose (afecta ciclos draft futuros).
  - Las modificaciones **NO afectan** ciclos `active|closed`.
  - Reports y formularios de evaluadores leen de `cycle.template_snapshot`.
- **BR-C.2.4** — Si admin necesita "aplicar cambios" al ciclo activo (ej. corregir una typo en una pregunta), debe usar endpoint explícito `PATCH /cycles/:id/refresh-template-snapshot` que sobreescribe el snapshot. **Loguea audit con razón obligatoria**.
- **BR-C.2.5** — `evaluation_responses.template_snapshot_version` (nuevo campo): captura qué versión del snapshot vio el evaluador al responder. Permite reconstrucción 100% post-mortem.

#### Casos de uso

- **UC-C.2.1 — Edición intencional de plantilla:** Admin edita plantilla "360° Q1" (corrige 1 pregunta). El ciclo Q1 ya está activo → no le afecta. Pero ciclo Q2 (en draft) usará la nueva versión al lanzar.
- **UC-C.2.2 — Hotfix mid-cycle:** Pregunta tenía typo "manager" → "managere". 50% ya respondieron. Admin debe llamar `refresh-template-snapshot` con razón "Corrección de typo en pregunta 7" → todos los formularios pendientes ven la corrección, los completados se preservan.
- **UC-C.2.3 — Cambio de pesos mid-cycle:** Admin se da cuenta que peso de DR debería ser 30% no 25%. Ciclo activo. Sistema **bloquea** el cambio con error: "No se puede modificar pesos de un ciclo activo. Use el dashboard de cierre para aplicar pesos finales antes de cerrar."

#### Edge cases

- **EC-C.2.1** — Si admin restaura una versión vieja del template → solo afecta ciclos draft (no activos).
- **EC-C.2.2** — Snapshot JSONB grande (>1MB) → considerar compresión gzip o foreign key a tabla separada.

#### Validaciones y métricas

- **MV-C.2.1** — Hash del template_snapshot al launch vs final: si difiere y no hay log de `refresh-template-snapshot`, alerta de integridad.
- **MV-C.2.2** — Performance: snapshot+save < 500ms.

---

### 🟧 F-C.4 — Cascade en deactivate user es parcial

#### Estado actual

- `users.service.ts:621-627` — al desactivar user, assignments `pending|in_progress` → `cancelled`.
- ✅ Responses `completed` se preservan.
- ❌ NO se notifica al admin del ciclo.
- ❌ No se sugiere reemplazo si el user era único (ej. único manager de un evaluado).

#### Reglas de negocio (BR-C.4)

- **BR-C.4.1** — Al desactivar un user que tenga **assignments activos** (pending|in_progress) en ciclos `active`:
  1. El sistema **bloquea** el delete con error "Este user tiene N assignments activos en M ciclos. Cierre los assignments o el ciclo antes de desactivarlo."
  2. **Override** disponible para tenant_admin con razón obligatoria. Audit log obligatorio.
- **BR-C.4.2** — Si se aplica el override, el sistema:
  1. Cancela los assignments del user (como evaluator) con flag `cancelled_reason: 'evaluator_deactivated'`.
  2. Para cada evaluatee afectado, dispara una **notificación al cycle owner** (creator) con detalles: "El evaluador X dejó la empresa. El evaluado Y queda con N evaluaciones activas en lugar de M. Considera asignar un evaluador alternativo."
  3. Si la cancelación lleva el `responseRatio` del rol bajo umbral (ver BR-B.3) → **alert automático** al admin.
- **BR-C.4.3** — Se permite al admin un endpoint `replaceEvaluator(assignmentId, newEvaluatorId, reason)` que reemplaza el evaluator en assignments cancelados. Crea nueva fila con flag `isReplacement: true, replacedAssignmentId: <oldId>`.

#### Casos de uso

- **UC-C.4.1 — Manager renuncia mid-cycle:** María (mgr de 5 personas) renuncia. Admin intenta desactivar → bloqueado. Admin usa override con razón "Renuncia voluntaria, último día 15/oct". Sistema cancela las 5 assignments de María como evaluator. Notifica al cycle owner.
- **UC-C.4.2 — Reemplazo proactivo:** Admin reemplaza a María por Sofía (nueva mgr) usando `replaceEvaluator` en cada assignment. Sofía recibe email "Has sido asignada para evaluar a [N] colaboradores en el ciclo Q1".

#### Edge cases

- **EC-C.4.1** — Si user es evaluatee (no evaluator) → cancelar también sus self-evaluations + notificar a sus evaluators.
- **EC-C.4.2** — Si user a desactivar está en cicles cerrados → no hay impacto operativo, solo audit log.

#### Validaciones y métricas

- **MV-C.4.1** — Tasa de assignments cancelados por desactivación / total assignments < 5% (signo de alta rotación o flow problemático).

---

## DIMENSIÓN D · CONSOLIDACIÓN DE RESULTADOS

### 🟧 F-D.1 — Sin manejo de outliers

#### Estado actual

`reports.service.ts:1259-1287` — promedio simple `sum/count` sin tratamiento de extremos.

#### Reglas de negocio (BR-D.1)

- **BR-D.1.1** — El sistema debe ofrecer 4 estrategias de manejo de outliers configurables por ciclo:
  - `NONE` (default; comportamiento actual) — promedio simple.
  - `TRIMMED_MEAN_20` — descarta el 20% más alto y el 20% más bajo (tukey trimmed mean).
  - `MEDIAN` — usa la mediana en lugar del promedio.
  - `WINSORIZED` — reemplaza outliers (>1.5× IQR) con el valor del Q1/Q3 más cercano.
- **BR-D.1.2** — La estrategia se persiste en `cycle.settings.outlierStrategy`.
- **BR-D.1.3** — `TRIMMED_MEAN_20` y `WINSORIZED` solo se aplican si hay **≥5 respuestas en el rol** (con menos, no hay margen para descartar).
- **BR-D.1.4** — Independiente de la estrategia, el sistema **siempre debe detectar outliers estadísticos** (valores fuera de Q1 - 1.5×IQR o Q3 + 1.5×IQR) y exponerlos en el report con flag `hasOutliers: true` y la lista de respuestas atípicas.

#### Casos de uso

- **UC-D.1.1 — Calibración estratégica:** Ciclo serio para promotion. Admin elige `TRIMMED_MEAN_20`. Si 5 pares califican `[8, 8, 8, 8, 1]`, el "1" se descarta → score = 8.0.
- **UC-D.1.2 — Detección sin descarte:** Admin elige `NONE` pero quiere ver outliers. Report muestra "⚠ Una respuesta del rol peer fue significativamente menor que el resto (1 vs mediana 8). Investigar contexto."

#### Edge cases

- **EC-D.1.1** — `TRIMMED_MEAN` con n=4 → descartaría 0.8 valores (no aplica). Cae a strategy `MEDIAN` automáticamente.
- **EC-D.1.2** — Si todas las respuestas son idénticas (ej. todos dieron 8) → IQR=0 → ningún outlier detectado.

#### Validaciones y métricas

- **MV-D.1.1** — Test estadístico: dataset `[1,8,8,8,8]` con TRIMMED_MEAN_20 → 8.0. Con NONE → 6.6.

---

### 🟨 F-D.4 — Sin métricas de inter-rater reliability

#### Estado actual

- `bellCurveDistribution` calcula stddev pero solo a nivel ciclo entero.
- No hay reliability score por evaluado × rol × competencia.

#### Reglas de negocio (BR-D.4)

- **BR-D.4.1** — Para cada evaluado × rol × sección con ≥3 respuestas, el sistema debe calcular:
  - `consistency_score` = 1 - (stddev / max_possible_stddev) — escala 0-1, donde 1 = total acuerdo.
  - Sobre escala 1-5: `max_possible_stddev = 2` (mitad del rango).
  - Ejemplo: 5 pares califican `[4,4,4,5,4]` → stddev=0.4 → consistency = 1 - (0.4/2) = 0.8.
- **BR-D.4.2** — Niveles de consistency con clasificación textual:
  - `≥0.85` → "Alta consistencia" (verde)
  - `0.65-0.85` → "Consistencia moderada" (amarillo)
  - `<0.65` → "Baja consistencia, revisar polarización" (rojo)
- **BR-D.4.3** — Reports deben incluir `reliability` por sección:
  ```json
  {
    "section": "Liderazgo",
    "overall": 7.5,
    "byRelation": { "manager": 8.0, "peer": 7.2, "dr": 6.8 },
    "reliability": {
      "peer": { "consistency": 0.65, "stddev": 0.7, "n": 5, "level": "moderate" },
      "dr": { "consistency": 0.42, "stddev": 1.16, "n": 4, "level": "low", "warning": "Polarización detectada" }
    }
  }
  ```
- **BR-D.4.4** — Cuando consistency < 0.65 en cualquier sección/rol, mostrar warning visible en el report del evaluado y permitir al admin ver respuestas anonimizadas para investigar.

#### Casos de uso

- **UC-D.4.1 — Polarización en pares:** 5 pares califican Liderazgo `[8, 9, 8, 2, 8]`. Consistency = 0.42. Report muestra warning + admin puede ver respuestas (anonimizadas).
- **UC-D.4.2 — Consenso sano:** 5 pares califican Comunicación `[8, 8, 9, 8, 8]`. Consistency = 0.95. Sin warnings.

#### Edge cases

- **EC-D.4.1** — Si n<3 → no calcular reliability (no significativo). Mostrar `n: 2, reliability: null`.
- **EC-D.4.2** — Si todas las respuestas son idénticas (n≥3) → consistency = 1.0 perfecto.

#### Validaciones y métricas

- **MV-D.4.1** — Performance: cálculo de reliability para 50 evaluados × 5 secciones × 4 roles = 1000 cálculos en <500ms.

---

### 🟩 F-D.3 — Rater bias normalization (BACKLOG)

#### Recomendación: backlog para v3+

Implementación correcta requiere:
- ≥10 evaluaciones por evaluator histórico para z-score reliable.
- UI de explicación al usuario (compleja).
- Riesgo de "reverse engineering" del bias (evaluators ajustando para "compensar").

Mejor estrategia para SMB: en su lugar implementar BR-D.4 (reliability score). Si hay polarización, el admin lo ve y decide qué hacer manualmente.

---

## 📊 ROADMAP RECOMENDADO

### Sprint 1 — Snapshotting (MUST HAVE)

| Finding | Esfuerzo |
|---|---|
| F-C.1 — snapshot organigrama | 5d |
| F-C.2 — snapshot template + pesos | 2d |
| F-C.4 — cascade strict + replaceEvaluator | 2d |
| **Total Sprint 1** | **~9 días** |

### Sprint 2 — Robustez de cálculo (HIGH VALUE)

| Finding | Esfuerzo |
|---|---|
| F-A.1 — estrategias de excepción | 3d |
| F-B.2 — transparencia redistribución | 1d |
| F-B.3 — umbral mín respuestas | 2d |
| F-D.1 — outlier strategies | 2d |
| **Total Sprint 2** | **~8 días** |

### Sprint 3 — Calidad y diferenciación (NICE TO HAVE)

| Finding | Esfuerzo |
|---|---|
| F-D.4 — reliability metrics | 3d |
| F-A.3 — peer scoping configurable | 2d |
| F-A.2 — min peer count config | 1d |
| F-B.4 — pesos por sección | 3d |
| **Total Sprint 3** | **~9 días** |

### Sprint 4 — Modelos avanzados (FUTURE)

| Finding | Esfuerzo |
|---|---|
| F-A.4 — matrix reporting | 5d |
| F-D.3 — rater bias normalization | 5d (backlog real) |

---

## 🎯 CONCLUSIONES Y RECOMENDACIÓN FINAL

### Para empresas piloto (<30 personas, baja rotación)

El sistema es **funcional tal como está**, pero documentar las limitaciones C.1 y D.1 explícitamente al cliente. Aceptar deuda técnica corto plazo.

### Antes de cualquier deploy productivo serio (>50 evaluados, ciclos pagos)

**Implementar Sprint 1 completo** (snapshotting + cascade strict). Sin esto, los resultados son **falsificables retroactivamente** por cambios de organigrama. Es deuda técnica que se vuelve catastrófica con escala.

### Como diferencial de mercado

Implementar **Sprint 2 + Sprint 3** (outliers + reliability metrics + estrategias de excepción) — ningún competidor SMB en LATAM lo tiene, y es lo que distinguirá eva360 cuando entren a clientes mid-market.

### Calendario sugerido

- **Sprint 1**: 2 semanas (must-have antes de prod-ready a escala).
- **Sprint 2**: 2 semanas (high-value, alinear con primer cliente enterprise).
- **Sprint 3**: 2 semanas (diferencial competitivo, alinear con go-to-market mid-market).
- **Sprint 4**: backlog (cuando pricing justifique).

**Total inversión recomendada para "production-grade integrity": ~6 semanas (1.5 meses) de un dev senior.**

---

## 📎 ANEXO A — Archivos de código relevantes

| Componente | Archivo | Acción |
|---|---|---|
| Auto-asignación | `apps/api/src/modules/evaluations/evaluations.service.ts:604-840` | Refactor BR-A.1, A.2, A.3, A.4 |
| Lanzamiento ciclo | `apps/api/src/modules/evaluations/evaluations.service.ts:932-1020` | Implementar BR-C.1, C.2 (snapshots) |
| Cálculo radar | `apps/api/src/modules/reports/reports.service.ts:1124-1325` | Refactor BR-B.2, B.3, D.1, D.4 |
| Cálculo selfVsOthers | `apps/api/src/modules/reports/reports.service.ts:1330-1430` | Refactor BR-B.2, D.1, D.4 |
| Deactivate user | `apps/api/src/modules/users/users.service.ts:561-650` | Refactor BR-C.4 (cascade strict) |
| Entidad cycle | `apps/api/src/modules/evaluations/entities/evaluation-cycle.entity.ts` | Agregar campos de snapshot |
| Entidad assignment | `apps/api/src/modules/evaluations/entities/evaluation-assignment.entity.ts` | Agregar `relation_basis` |

---

## 📎 ANEXO B — Migrations SQL propuestas

```sql
-- BR-A.1: Estrategias de excepción
ALTER TABLE evaluation_cycles
  ADD COLUMN IF NOT EXISTS settings JSONB; -- ya existe, agregar keys: missingRoleStrategy, peerScopingStrategy, etc.

CREATE TABLE IF NOT EXISTS cycle_evaluatee_weights (
  cycle_id UUID NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
  evaluatee_id UUID NOT NULL,
  effective_weights JSONB NOT NULL,
  strategy_used VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, evaluatee_id)
);

-- BR-A.2: minPeerCount configurable
-- (tenant.settings y cycle.settings JSONB ya existen, no requieren migration)

-- BR-A.4: secondary managers
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS secondary_managers UUID[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_users_secondary_managers ON users USING GIN(secondary_managers);

-- BR-C.1: snapshot organigrama
CREATE TABLE IF NOT EXISTS cycle_org_snapshots (
  cycle_id UUID NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  primary_manager_id UUID NULL,
  secondary_managers UUID[] NULL,
  department_id UUID NULL,
  department_name VARCHAR(200) NULL,
  hierarchy_level INT NULL,
  role VARCHAR(50) NULL,
  is_active BOOLEAN NOT NULL,
  late_addition BOOLEAN NOT NULL DEFAULT false,
  excluded_at TIMESTAMPTZ NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cycle_org_snapshot_user ON cycle_org_snapshots(user_id);

-- BR-C.1: relation_basis en assignments
ALTER TABLE evaluation_assignments
  ADD COLUMN IF NOT EXISTS relation_basis JSONB NULL;

-- BR-C.2: snapshot template + pesos
ALTER TABLE evaluation_cycles
  ADD COLUMN IF NOT EXISTS template_version_at_launch INT NULL,
  ADD COLUMN IF NOT EXISTS template_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS weights_at_launch JSONB NULL,
  ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ NULL;

-- BR-C.2: snapshot version en responses
ALTER TABLE evaluation_responses
  ADD COLUMN IF NOT EXISTS template_snapshot_version INT NULL;
```

---

**Fin del documento.**

**Próximo paso:** consensuar este documento con stakeholders → priorizar Sprint 1 → kickoff implementación.
