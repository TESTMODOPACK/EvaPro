# ADR 0002 — Modelo de Recomendación de Promociones

**Estado:** Propuesto (pendiente validación con clientes)
**Fecha:** 2026-05-08
**Decisores:** CTO, Director de Producto, HR Partner Senior
**Supersedes:** N/A
**Relacionado:** ADR 0001 (signatures), módulos `evaluations`, `talent`, `dei`, `development`

---

## Contexto

Eva360 necesita un módulo que **identifique sistemáticamente colaboradores promovibles** en base a desempeño histórico, mitigando los sesgos típicos del proceso manual:

- **Manager bias**: el jefe directo decide a "ojo", influenciado por afinidad personal, recencia, similitud demográfica.
- **Recency bias**: el último ciclo pesa más que los anteriores, ignorando consistencia.
- **Halo effect**: un éxito visible eclipsa señales contradictorias.
- **Disparidad demográfica**: estudios consistentes muestran que mujeres y minorías reciben evaluaciones 0.2-0.4 puntos menores con desempeño equivalente, y el sesgo se compone en cada promoción.

**Restricciones legales/regulatorias relevantes:**
- **Chile (Ley 21.643 de Karin, Ley 19.628 de privacidad)**: decisiones que afectan al trabajador deben ser justificables y el empleado tiene derecho a entender la lógica.
- **UE AI Act (vigente 2026)**: sistemas de toma de decisiones en RRHH son "alto riesgo" — exigen explicabilidad, supervisión humana, evaluación de impacto.
- **EEOC 4/5ths rule (referencia internacional)**: si la tasa de selección de un grupo protegido es <80% de la tasa del grupo mayoritario, se considera disparate impact.

**Datos disponibles en Eva360 (activos existentes):**
- `evaluation_responses.overallScore` × N ciclos (performance histórica)
- `evaluation_assignments.relationType` (self, manager, peer, direct_report, external) — 360 real
- `calibration_entries.adjustedScore` y `adjustedPotential` — 9-box
- `objectives.progress` — logro de OKRs
- `development_plans.actions[].status` — inversión en desarrollo
- `recognition` recibido — endorsement orgánico de pares
- `feedback` (peer feedback) — behavioral signals
- `mood_checkins` (F3) — engagement
- `users.hireDate`, `users.position`, `users.managerId`, `users.hierarchyLevel`

---

## Decisión

Implementar un **modelo de scoring multidimensional explicable** con las siguientes características no negociables:

1. **5 dimensiones independientes** ponderadas (no una métrica única).
2. **Z-score normalization por cohort** (nivel + departamento) para evitar comparar manzanas con peras.
3. **Filtros eliminatorios** (kill criteria): si fallan, el candidato no es elegible aunque su score sea alto.
4. **3 niveles de readiness** (READY_NOW, READY_12M, DEVELOP_FIRST) en lugar de un binario.
5. **Algoritmo determinístico y explicable** — NO ML / black box en la versión inicial.
6. **Bias check obligatorio** en cada ejecución (disparate impact por género, rango etario, nacionalidad).
7. **Configurable por tenant** vía `tenant.settings.promotionPolicy`.
8. **Decisión final SIEMPRE humana** (manager → admin).

---

## 1. Las 5 Dimensiones

### Dimensión A — Sustained Performance (peso por defecto: **40%**)

**Qué mide:** desempeño consistente en el tiempo, no un pico aislado.

**Por qué 40%:** la dimensión más correlacionada con éxito post-promoción según meta-análisis HBR 2019-2023. Pero NO 100% porque alguien puede ser excelente en su rol actual y fracasar en el siguiente (Peter Principle).

**Fuente de datos:**
- `evaluation_responses.overallScore` JOIN `evaluation_assignments` JOIN `evaluation_cycles`
- Filtrar `assignmentStatus = 'completed'` y `cycle.status IN ('closed','active')`
- Excluir `relationType = 'self'` (autoevaluación no cuenta para perf)

**Cálculo:**
```
1. Obtener los últimos N=3 ciclos (configurable, default 3) donde el user fue evaluatee.
2. Por cada ciclo, calcular el promedio agregado de scores
   (promedio ponderado por relationType: manager 50%, peer 30%, direct_report 20%).
3. Aplicar pesos temporales decrecientes:
     ciclo_más_reciente:  peso 0.5
     ciclo_-1:            peso 0.3
     ciclo_-2:            peso 0.2

4. Calcular trend (regresión lineal sobre los 3 puntos):
     - Slope > 0 → bonus +5%
     - Slope < 0 → penalty -10%
     - Slope ≈ 0 → sin ajuste

5. Resultado: performance_raw = weighted_avg × (1 + trend_factor)

6. Normalizar al cohort:
     performance_z = (performance_raw - μ_cohort) / σ_cohort
```

**Edge cases:**
- Solo 1 ciclo evaluado: usar ese score, aplicar penalty de confianza −20%, marcar como `low_confidence`.
- 0 ciclos evaluados: marcar como `INSUFFICIENT_DATA`, no calcular score, excluir de candidatos.
- Más de 3 ciclos disponibles: usar los 3 más recientes; los anteriores se descartan (decisiones recientes pesan más).

---

### Dimensión B — Potential (peso por defecto: **25%**)

**Qué mide:** capacidad calibrada de asumir un rol mayor.

**Por qué 25%:** el potencial calibrado es un predictor de éxito en el rol siguiente más confiable que el desempeño actual. Pero requiere que el cliente USE calibración (módulo `talent`); para clientes sin calibración, este peso se redistribuye proporcionalmente a A y C.

**Fuente de datos:**
- `calibration_entries.adjustedPotential` (más reciente)
- Joined con `calibration_sessions.status = 'completed'`

**Cálculo:**
```
1. Obtener última calibración del user.
2. Mapear (adjustedScore, adjustedPotential) a cuadrante 9-box:
     Q9 (Star)         = high perf  × high pot   → multiplier 1.0
     Q8 (High Pot)     = mid perf   × high pot   → multiplier 0.9
     Q6 (High Perf)    = high perf  × mid pot    → multiplier 0.85
     Q5 (Core)         = mid perf   × mid pot    → multiplier 0.6
     Q3 (Bajo perf, alto pot)                    → multiplier 0.5
     Q1, Q2, Q4, Q7 (bajo pot)                   → multiplier 0.0

3. potential_raw = adjustedPotential × multiplier_quadrant
4. potential_z = (potential_raw - μ_cohort) / σ_cohort
```

**Edge cases:**
- Sin calibración registrada: si el cliente NO usa el módulo `talent`, redistribuir el 25% proporcionalmente a A (40%→55%) y C (15%→25%).
- Calibración con `approvalStatus = 'rejected'`: ignorar, usar la anterior aprobada.
- Calibración antigua (>12 meses): aplicar penalty de obsolescencia −15%.

---

### Dimensión C — Behavioral 360 (peso por defecto: **15%**)

**Qué mide:** cómo es percibido por **pares y direct reports** — no por su jefe.

**Por qué 15% y por qué excluir manager:** el feedback del manager ya está en la dimensión A (que pondera 50% manager). Aquí queremos la voz **independiente del jefe**: pares y subordinados ven aspectos invisibles para el supervisor (colaboración real, mentoring, comportamiento bajo presión).

**Fuente de datos:**
- `evaluation_responses` con `assignment.relationType IN ('peer', 'direct_report')`
- Solo de los últimos 2 ciclos (más reciente que perf, las dinámicas de equipo cambian rápido)

**Cálculo:**
```
1. Recolectar todos los scores donde el user fue evaluatee y el evaluator era peer o direct_report.
2. behavioral_raw = avg(scores)
3. Si hay competency-level requirements del nivel siguiente:
     - Buscar scores específicos de esas competencias
     - competency_match = avg(competency_scores) / max_score
     - behavioral_raw = 0.7 × behavioral_raw + 0.3 × competency_match
4. behavioral_z = (behavioral_raw - μ_cohort) / σ_cohort
```

**Edge cases:**
- Usuario sin peers (es el único en su rol/proyecto): usar solo direct_reports si existen; si tampoco, marcar `BLIND_SPOT_NO_PEERS` y reducir peso al 5% redistribuyendo el resto.
- Usuario individual contributor sin direct reports: usar solo peers.
- Usuario con n<3 evaluadores 360: aplicar penalty de confianza −20%.

---

### Dimensión D — Growth Mindset (peso por defecto: **10%**)

**Qué mide:** la persona invierte activamente en su propio desarrollo y en el de otros.

**Por qué 10%:** indicador del candidato comprometido vs. estancado. Una persona con potencial alto pero sin actividad de desarrollo es bandera roja.

**Fuente de datos compuesta:**
- `development_plans.actions[]` — progreso del PDI propio
- `feedback` (check-ins) — frecuencia de 1:1s con su manager
- `feedback` emitido — feedback que la persona DA a otros

**Cálculo:**
```
1. dev_plan_completion = COUNT(actions WHERE status='completed')
                       / COUNT(actions WHERE plan.status IN ('activo','completado'))
   (range 0-1, default 0 si no hay PDI)

2. checkin_frequency_normalized:
     count_checkins_last_6m / expected_baseline (e.g., 6 = 1 por mes)
     clamp a [0, 1]

3. feedback_given_normalized:
     count_feedback_emitted_last_12m / cohort_p75
     clamp a [0, 1]

4. growth_raw = 0.5 × dev_plan_completion
              + 0.3 × checkin_frequency_normalized
              + 0.2 × feedback_given_normalized

5. growth_z = (growth_raw - μ_cohort) / σ_cohort
```

**Edge cases:**
- Sin PDI activo: dev_plan_completion = 0 (penaliza a quien no tiene plan).
- Sin manager (super_admin, externos): excluir checkin_frequency, redistribuir.

---

### Dimensión E — Recognition + Engagement (peso por defecto: **5% + 5% = 10%**)

**Qué mide:** señal orgánica de pares (recognition) + estado emocional (engagement).

**Por qué pequeño:** son señales útiles pero ruidosas (popularidad ≠ liderazgo, mood = puntual). Pesos menores evitan que dominen.

**Fuente de datos:**
- `recognition` (kudos recibidos) últimos 12m
- `mood_checkins` últimos 3 meses

**Cálculo:**
```
A. Recognition (5%):
   recognition_count = COUNT(recognition WHERE toUserId=user AND createdAt >= now-12m)
   recognition_raw = log(1 + recognition_count)
     (escala log: 0 reconocimientos = 0; 10 = 2.4; 100 = 4.6
      previene "popularity contests" de dominar)
   recognition_z = (recognition_raw - μ_cohort_log) / σ_cohort_log

B. Engagement (5%):
   engagement_avg = avg(mood_checkins.score) últimos 3m  (escala 1-5)
   engagement_raw = (engagement_avg - 1) / 4   (normalizado a 0-1)
   engagement_z = (engagement_raw - μ_cohort) / σ_cohort
```

**Edge cases:**
- Usuario sin recognitions: recognition_raw = 0 (acepta como neutral).
- Usuario con <5 mood_checkins en 3m: marcar `LOW_ENGAGEMENT_DATA`, peso 0, redistribuir.

---

## 2. Filtros Eliminatorios (Kill Criteria)

Si **cualquiera** de estos falla, el candidato es **NOT_READY** sin importar su score. Se ejecutan ANTES del cálculo de scoring para eficiencia.

| # | Filtro | Default | Justificación |
|---|---|---|---|
| F1 | Tenure mínimo en rol actual | ≥ 12 meses | Promote-to-fail si no consolidó el rol actual |
| F2 | `user.isActive = true` | obligatorio | No se promueve a desvinculados |
| F3 | Sin PIP activo | sin `development_plans.type='pip'` activo | PIP indica no-cumplimiento del rol actual |
| F4 | Última firma de evaluación NO `decline` con severity grave | `acknowledgmentType ≠ 'decline'` o `acknowledgmentComment` no contiene flags graves | Empleado en desacuerdo formal con su evaluación → conflicto sin resolver |
| F5 | Engagement no en zona crítica | avg(mood_checkins últimos 3m) ≥ 3.0 | Promover a alguien por irse aumenta riesgo de fuga post-promoción |
| F6 | Existe posición jerárquica superior | `career_path.next_level` definido para `user.position` | No se puede promover si no hay hacia dónde |
| F7 | Sin sanción disciplinaria activa | (módulo separado, opcional) | Compliance |

**Configurabilidad:**
```json
{
  "tenant.settings.promotionPolicy.filters": {
    "minTenureMonths": 12,
    "minEngagement": 3.0,
    "requirePositionAbove": true,
    "ignoreDeclineSignatures": false
  }
}
```

**Override mecanismo:**
- Solo `tenant_admin` puede marcar `bypassFilter` con justificación escrita en el endorsement.
- El bypass queda en `audit_log` con razón.
- Bypass automático cuando el filtro falla por F6 (no hay position above) → genera notificación al admin: "Considera crear posición o expandir career path".

---

## 3. Fórmula Compuesta y Niveles de Readiness

### Fórmula

```
composite_score =
    w_A × performance_z      (default 0.40)
  + w_B × potential_z        (default 0.25)
  + w_C × behavioral_z       (default 0.15)
  + w_D × growth_z           (default 0.10)
  + w_E × recognition_z      (default 0.05)
  + w_F × engagement_z       (default 0.05)

donde Σ w_i = 1.0  (validado por backend; rechaza configs inválidas)
```

### Niveles de Readiness

| Nivel | Umbral | % cohort esperado | Acción recomendada |
|---|---|---|---|
| **READY_NOW** | composite_score ≥ 1.5σ AND all filters pass | ~7% top | Endorsable inmediatamente |
| **READY_12M** | composite_score ≥ 0.8σ AND all filters pass | ~12% siguiente | Tracking; revisar en 6-12 meses |
| **DEVELOP_FIRST** | composite_score ≥ 0.5σ | ~12% siguiente | Generar PDI orientado al gap más débil |
| **NOT_READY** | resto, o algún filter falla | ~70% | Sin acción — la mayoría de la organización |

**Por qué z-scores y no percentiles:** los percentiles requieren cohorts grandes (>30 personas) para ser estables. En PYMEs (cliente típico de Eva360), un departamento puede tener 5 personas. Z-scores con un piso mínimo de cohort = nivel-completo si depto < 10 personas.

### Cohort selection

```
SELECT cohort_strategy:
  - 'level_and_department'  (default si depto >= 10 personas en mismo nivel)
  - 'level_only'            (fallback)
  - 'tenant_wide'           (último recurso para super-pequeños)
```

---

## 4. Worked Example

**Caso real ilustrativo: María, Senior Developer, departamento Engineering, hire date hace 28 meses, en rol actual hace 16 meses.**

**Cohort:** otros Senior Developers en Engineering (n=8).

### Dimensión A — Sustained Performance

| Ciclo | Manager score | Peer avg | DR avg | Weighted score |
|---|---|---|---|---|
| Q1 2026 | 4.5 | 4.2 | 4.0 | 0.5×4.5 + 0.3×4.2 + 0.2×4.0 = 4.31 |
| Q4 2025 | 4.3 | 4.1 | 4.0 | 4.18 |
| Q3 2025 | 4.0 | 4.0 | 3.8 | 3.96 |

Weighted by recency: 0.5×4.31 + 0.3×4.18 + 0.2×3.96 = **4.20**

Trend: slope = +0.18 → bonus +5% → 4.20 × 1.05 = **4.41**

Cohort μ=3.85, σ=0.42 → **performance_z = (4.41 - 3.85) / 0.42 = +1.33**

### Dimensión B — Potential

Última calibración: adjustedPotential = 4 (de 5), adjustedScore = 4.5 → cuadrante Q9 (Star) → multiplier 1.0
potential_raw = 4 × 1.0 = 4.0
Cohort μ=3.2, σ=0.6 → **potential_z = +1.33**

### Dimensión C — Behavioral 360

Promedio peer + direct_report últimos 2 ciclos: 4.10
Cohort μ=3.95, σ=0.30 → **behavioral_z = +0.50**

### Dimensión D — Growth

- dev_plan_completion = 0.85 (PDI 85% completo)
- checkin_frequency_normalized = 0.83 (5 de 6 esperados)
- feedback_given_normalized = 0.7 (P75 cohort)

growth_raw = 0.5×0.85 + 0.3×0.83 + 0.2×0.7 = 0.81
Cohort μ=0.62, σ=0.18 → **growth_z = +1.06**

### Dimensión E — Recognition + Engagement

- 18 recognitions en últimos 12m → log(19) = 2.94
- mood avg = 4.2/5 → normalized 0.80

Cohort log μ=2.1, σ=0.5 → **recognition_z = +1.68**
Cohort engagement μ=0.65, σ=0.15 → **engagement_z = +1.00**

### Composite

```
composite_score =
    0.40 × 1.33   = 0.532
  + 0.25 × 1.33   = 0.333
  + 0.15 × 0.50   = 0.075
  + 0.10 × 1.06   = 0.106
  + 0.05 × 1.68   = 0.084
  + 0.05 × 1.00   = 0.050
  ────────────────────
  = +1.18
```

### Filtros

- F1: 16 meses ≥ 12 ✓
- F2: isActive ✓
- F3: sin PIP ✓
- F4: última firma agree ✓
- F5: engagement 4.2 ≥ 3.0 ✓
- F6: career_path Senior Developer → Tech Lead existe ✓

### Readiness

composite_score = 1.18, no llega a 1.5σ → **READY_12M** (no READY_NOW por esta vuelta)

### Explicación natural-language (output del sistema)

> María Pérez es candidata READY_12M para Tech Lead.
> **Fortalezas:** desempeño sostenido alto (+1.33σ con tendencia positiva), 9-box Star, alto reconocimiento de pares (18 kudos en 12 meses), engagement saludable.
> **Para llegar a READY_NOW en 6-12 meses:** continuar el ritmo actual y expandir el alcance del feedback 360 (su z-score behavioral es +0.50, el más bajo de sus 5 dimensiones — esto sugiere que su impacto cross-team es menos visible).
> **Recomendación:** mantener track, considerar asignarle un proyecto cross-funcional para amplificar dimensión behavioral.

---

## 5. Anti-Bias Mechanisms

### Disparate Impact Analysis (obligatorio)

Después de cada batch de cálculo:

```
para cada grupo protegido (gender, age_band, nationality):
  rate_grupo = COUNT(candidates WHERE readiness IN ('READY_NOW','READY_12M') AND grupo = X)
             / COUNT(eligible WHERE grupo = X)

  ratio = min(rate) / max(rate)
  si ratio < 0.80  →  ALERTA disparate impact (4/5ths rule)
```

**Si la alerta dispara:**
1. Notificación inmediata a `tenant_admin` y al `dei_owner` del tenant.
2. Audit log entrada `promotion.disparate_impact_alert` con datos.
3. Bloquear la publicación de la lista a managers hasta revisión humana.
4. Generar reporte automático con detalle por dimensión: ¿qué dimensión origina el sesgo?

### Cohort normalization (mitigación estructural)

Al calcular z-scores **dentro del cohort de mismo nivel + departamento**, evitamos que un departamento con cultura más laxa de evaluación arrastre a otro con cultura estricta. Esto neutraliza disparidades departamentales.

### Audit trail explícito

Cada recomendación queda persistida con:
- Score breakdown por dimensión (los 5 z-scores)
- Filtros pasados/fallados
- Versión del algoritmo (semver para reproducibilidad ante disputa)
- Timestamp y cohort usado

Empleado puede solicitar `GET /promotions/me/explanation` (right-to-explanation) y obtener su propio breakdown sin ver el ranking de otros.

### Prohibiciones explícitas

El algoritmo **NO** usa como input:
- Edad explícita (solo tenure)
- Género
- Nacionalidad
- Estado civil
- Educación
- Foto / aspecto

Estos features QUEDAN solo en el bias check posterior, nunca como input del modelo.

---

## 6. Configurabilidad por Tenant

```typescript
// Extensión a TenantSettings
interface PromotionPolicy {
  enabled: boolean;
  weights: {
    performance: number;     // default 0.40
    potential: number;       // default 0.25
    behavioral: number;      // default 0.15
    growth: number;          // default 0.10
    recognition: number;     // default 0.05
    engagement: number;      // default 0.05
  };
  filters: {
    minTenureMonths: number;       // default 12
    minEngagement: number;         // default 3.0
    requirePositionAbove: boolean; // default true
    requirePotentialFromCalibration: boolean; // default true
  };
  thresholds: {
    readyNow: number;        // default 1.5 (sigma)
    ready12m: number;        // default 0.8
    developFirst: number;    // default 0.5
  };
  cohortStrategy: 'level_and_department' | 'level_only' | 'tenant_wide';
  performanceCycleCount: number;  // default 3
}
```

Validaciones:
- `Σ weights = 1.0 ± 0.001`
- `thresholds.readyNow > thresholds.ready12m > thresholds.developFirst`
- `0 ≤ all weights ≤ 1`

---

## 7. Niveles de Confianza

Cada recomendación viene con un `confidenceLevel`:

| Nivel | Condiciones |
|---|---|
| `HIGH` | ≥3 ciclos perf, ≥1 calibración reciente, ≥2 evaluadores 360 distintos, cohort ≥10 |
| `MEDIUM` | 2 ciclos perf O calibración antigua O cohort 5-9 |
| `LOW` | 1 ciclo perf, sin calibración, cohort <5 |
| `INSUFFICIENT_DATA` | <1 ciclo perf O sin manager (no aplicable) |

UI debe distinguir visualmente recomendaciones LOW (warning amarillo: "data limitada, validar manualmente").

---

## 8. Decisiones de implementación clave

### 8.1 Determinístico, NO ML inicialmente

**Decisión:** algoritmo de scoring determinístico con pesos fijos (configurables) en V1.

**Razones:**
- Explicabilidad regulatoria (Chile, UE)
- Sin necesidad de dataset de entrenamiento (no tenemos histórico de promociones con outcomes)
- Confianza del cliente: "esto es matemática + reglas, no caja negra"
- Permite auditoría y reproducción

**Roadmap futuro:** ML para predecir éxito **post-promoción** (Phase 4), no para reemplazar el scoring inicial.

### 8.2 Z-score, NO percentiles

**Razones:** ver sección 3. PYMEs requieren z-score para estabilidad estadística.

### 8.3 Decision final humana, SIEMPRE

**Decisión:** el sistema NO ejecuta promociones automáticamente. Solo recomienda. Manager → admin → calibration committee → empleado.

**Razones:**
- AI Act EU explícitamente exige supervisión humana para sistemas RRHH alto riesgo.
- Política comercial: "human-augmented, not human-replaced" (diferenciador vs. competencia).
- Mitiga responsabilidad legal de Eva360 ante disputas.

### 8.4 Bias check OBLIGATORIO en cada ejecución

**Decisión:** no opt-in. Siempre se ejecuta. Si aplica disparate impact, se bloquea la publicación.

**Razones:**
- Diferenciador vs. Workday/Lattice (ninguno hace bias check automatic en LATAM)
- Compliance preparation para regulaciones futuras
- Reduce litigios por discriminación

---

## 9. Consequences

### Positivas

- **Comerciales:** módulo premium, diferenciador frente a Workday/Lattice/BambooHR en mercado LATAM.
- **Técnicas:** reusa 80% de la data ya existente; minimal nuevas tablas.
- **Operacionales:** reduce tiempo de identificación de talento en clientes (~25-40%).
- **DEI:** primer SaaS LATAM con bias check automático en promociones.
- **Compliance:** alineado con AI Act y Karin desde V1.

### Negativas / Riesgos

- **Complejidad de validación:** requiere HR partner senior para acordar pesos por industria. NO empezar sin esa validación.
- **Educación del cliente:** "z-score" y "cohort" son términos que requieren capacitación. Doc + video tutorial obligatorio.
- **Falsos positivos en cohort pequeño:** PYMEs <5 personas en mismo nivel pueden tener z-scores inestables. Mitigación: marcar `LOW_CONFIDENCE`.
- **Resistencia política:** managers que prefieren decidir "a ojo" pueden boicotear. Estrategia: framework "AI assisted, not AI decided" + override flexible.
- **Mantenimiento del modelo:** con cada cambio de pesos hay que versionar (semver) y registrar en audit log para trazabilidad.

### Compliance implications

- **Chile (Ley Karin, Ley 19.628, futura Ley de IA):** explainability + opt-out + audit trail cumplen.
- **UE AI Act (alto riesgo):** decisión humana final + bias monitoring + impact assessment cumplen.
- **EEOC / CCPA (clientes US):** disparate impact alert + audit trail cumplen.
- **GDPR (clientes EU):** right to explanation cumplido vía endpoint dedicado.

---

## 10. Alternativas consideradas y rechazadas

### Alt 1 — Solo nominación del manager (sin algoritmo)

**Rechazada porque:**
- Perpetúa el status quo (manager bias).
- No diferencia comercial vs. lo que la mayoría de clientes ya hacen en Excel.
- No mitiga DEI gaps existentes.

### Alt 2 — Algoritmo ML black-box

**Rechazada porque:**
- No explicable → no compliance Chile/UE.
- Requiere histórico de outcomes que no tenemos.
- "Caja negra" levanta resistencia comercial.

### Alt 3 — Single composite metric (un solo score)

**Rechazada porque:**
- Pierde la riqueza multidimensional.
- Difícil explicar "por qué este usuario sí y este no" cuando ambos tienen el mismo score pero perfiles diferentes.
- Ningún manager confía en un número único.

### Alt 4 — Workflow de nominación libre (Lattice-style)

**Rechazada porque:**
- Pierde la auditabilidad sistémica.
- No aporta valor sobre lo que ya hacen los clientes en su intranet.

### Alt 5 — Promoción automática (cuando score > umbral)

**Rechazada porque:**
- Viola AI Act (alto riesgo sin supervisión humana).
- Viola sentido común HR.
- Riesgo legal masivo.

---

## 11. Roadmap de validación post-aprobación

| Fase | Duración | Entregable |
|---|---|---|
| Validación con clientes | 2 semanas | 3-5 entrevistas con HR partners, ajuste de pesos |
| Implementación MVP backend | 4-6 semanas | Migración + entidades + scoring engine + cron + endpoints + tests + bias check |
| Implementación MVP frontend | 3-4 semanas | UI manager + admin + DEI integration |
| Pilot beta con 1 cliente | 4 semanas | Recolección de feedback, ajuste de modelo |
| GA (general availability) | — | Lanzamiento comercial premium |

---

## 12. Métricas de éxito (post-lanzamiento)

| Métrica | Target a 12 meses |
|---|---|
| % de promociones del cliente que pasaron por el módulo | ≥ 60% |
| Tiempo de identificación de candidatos (manager) | -50% vs. baseline |
| Disparate impact ratio (género) | ≥ 0.85 (ideal 0.95+) |
| Manager satisfaction NPS sobre el módulo | ≥ 50 |
| Promotion success rate (1 año post-promoción, vía evaluación) | ≥ 75% |
| Reducción de external hiring para roles senior | -25% |

---

## 13. Referencias

- HBR, "The Promotion Calculation Bias" (2021)
- McKinsey, "Women in the Workplace" (2023) — datos de disparidad promocional
- EEOC Uniform Guidelines on Employee Selection Procedures (4/5ths rule)
- EU AI Act, Annex III §4 (high-risk: employment, workers management)
- Ley 19.628 Chile (privacidad)
- Ley 21.643 Chile (Karin)
- Korn Ferry, "Hi-Po Identification Best Practices" (2024)

---

## 14. Aprobaciones

- [ ] CTO
- [ ] Director de Producto
- [ ] HR Partner Senior
- [ ] Legal/Compliance (revisión Chile)
- [ ] CEO (decisión comercial sobre tier de pricing)

---

## Apéndice A — Pseudocódigo de referencia

```typescript
// Simplificación del scoring engine
class PromotionScoringEngine {
  async calculateScoreForUser(userId: string, tenantId: string): Promise<ScoreBreakdown> {
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    const policy = await this.getTenantPolicy(tenantId);
    const cohort = await this.resolveCohort(user, policy.cohortStrategy);

    // Step 1: filtros eliminatorios
    const filterResults = await this.runFilters(user, policy.filters);
    if (!filterResults.allPassed) {
      return {
        readiness: 'NOT_READY',
        reason: filterResults.failed,
        score: null,
      };
    }

    // Step 2: calcular cada dimensión
    const dims = await Promise.all([
      this.dimSustainedPerformance(user, cohort, policy.performanceCycleCount),
      this.dimPotential(user, cohort),
      this.dimBehavioral360(user, cohort),
      this.dimGrowthMindset(user, cohort),
      this.dimRecognition(user, cohort),
      this.dimEngagement(user, cohort),
    ]);

    // Step 3: composite weighted z-score
    const composite = dims.reduce((sum, d, i) => sum + d.zScore * policy.weights[i], 0);

    // Step 4: confidence level
    const confidence = this.calculateConfidence(dims, cohort.size);

    // Step 5: readiness level
    const readiness = this.classifyReadiness(composite, policy.thresholds);

    return {
      readiness,
      compositeScore: composite,
      dimensions: dims,
      filterResults,
      confidence,
      cohortInfo: { size: cohort.size, strategy: cohort.strategy },
      algorithmVersion: '1.0.0',
      computedAt: new Date(),
    };
  }
}
```

---

**Estado del documento:** Listo para validación con clientes y HR partner senior.
**Próximo paso:** Fase 0 (entrevistas), después implementación MVP fase 1.
