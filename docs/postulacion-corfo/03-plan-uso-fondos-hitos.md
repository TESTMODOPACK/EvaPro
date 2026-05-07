# Plan de Uso de Fondos e Hitos — Start-Up Chile Build

> Proyecto **Eva360** · Ascenda SpA · Convocatoria 2026
> Cofinanciamiento Corfo: **CLP $15.000.000** (90%) + Aporte propio: **CLP $1.667.000** (10%) = **Total CLP $16.667.000**
> Plazo de ejecución: **6 meses** (con 1 mes adicional de cierre administrativo)

---

## 1. Resumen presupuestario por categoría

| # | Categoría | Subsidio Corfo | Aporte propio | Total | % |
|---|---|---:|---:|---:|---:|
| 1 | Recursos humanos | $8.100.000 | $900.000 | $9.000.000 | 54% |
| 2 | Marketing y ventas | $2.700.000 | $300.000 | $3.000.000 | 18% |
| 3 | Infraestructura tecnológica | $1.500.000 | $167.000 | $1.667.000 | 10% |
| 4 | Servicios profesionales | $1.800.000 | $200.000 | $2.000.000 | 12% |
| 5 | Viajes y gestión comercial | $900.000 | $100.000 | $1.000.000 | 6% |
| | **TOTAL** | **$15.000.000** | **$1.667.000** | **$16.667.000** | **100%** |

> **Nota**: la regla "Corfo 90% / aporte propio 10%" aplica al **total elegible**. Verificar en bases vigentes si hay restricciones por subcategoría (típicamente RR.HH. tiene tope del 70% del total).

---

## 2. Detalle por categoría

### Categoría 1 — Recursos humanos ($9.000.000)

**Justificación**: el cuello de botella hoy es ejecución técnica (cerrar features enterprise) y comercial (cerrar pilots). El subsidio cubre 6 meses de honorarios part-time/contractor.

| Concepto | Mes inicio | Meses | Costo mensual | Total | Hito asociado |
|---|---|---|---|---|---|
| Engineer fullstack (contractor 50%) | M1 | 6 | $900.000 | $5.400.000 | H1, H2 |
| Diseñadora UI/UX (freelance) | M1 | 4 | $400.000 | $1.600.000 | H1, H3 |
| Especialista comercial / SDR (contractor 50%) | M2 | 5 | $400.000 | $2.000.000 | H4, H6 |
| | | | | **$9.000.000** | |

**Gastos elegibles típicos**: honorarios profesionales con boleta de honorarios, contratos de prestación de servicios. **Sueldos con contrato fijo del founder NO son elegibles** en programas Build (verificar bases vigentes).

---

### Categoría 2 — Marketing y ventas ($3.000.000)

**Justificación**: necesitamos generar 10 demos calificadas/mes para alcanzar la meta de 15 clientes pagados al cierre.

| Concepto | Costo | Total | Hito |
|---|---|---|---|
| Google Ads + LinkedIn Ads (mid-market HR) | $300.000/mes × 5 | $1.500.000 | H4 |
| Producción de contenido (5 case studies + blog) | $150.000/case × 6 | $900.000 | H3 |
| Eventos sectoriales (HRTech LATAM, ASECH) | $200.000 × 2 | $400.000 | H4 |
| Herramientas SaaS (Apollo, HubSpot, Calendly) | $40.000/mes × 5 | $200.000 | H4 |
| | | **$3.000.000** | |

---

### Categoría 3 — Infraestructura tecnológica ($1.667.000)

**Justificación**: escalar capacidad para soportar pilots con 200–500 empleados sin caídas, mantener uso de IA Claude.

| Concepto | Costo mensual | Meses | Total | Hito |
|---|---|---|---|---|
| Render.com (production tier) | $80.000 | 6 | $480.000 | H1, H2 |
| Anthropic API (Claude — créditos IA) | $100.000 | 6 | $600.000 | H1 |
| Sentry + Datadog observabilidad | $60.000 | 6 | $360.000 | H1 |
| Cloudinary + Resend + servicios complementarios | $37.000 | 6 | $222.000 | — |
| | | | **$1.667.000* | |

> Cifras a redondear según plan elegido en cada proveedor.

---

### Categoría 4 — Servicios profesionales ($2.000.000)

**Justificación**: cerrar el gap legal/compliance que abre deals enterprise.

| Concepto | Costo | Hito |
|---|---|---|
| Contabilidad y administración (6 meses) | $400.000 | — |
| Asesoría legal (revisión T&C, contratos enterprise) | $300.000 | — |
| Gap analysis ISO 27001 (consultor externo) | $1.000.000 | H5 |
| Auditoría de seguridad técnica (pentest pre-deal enterprise) | $300.000 | H5 |
| | **$2.000.000** | |

---

### Categoría 5 — Viajes y gestión comercial ($1.000.000)

**Justificación**: validar mercado mexicano requiere presencia física para cerrar primeros 2 clientes en CDMX.

| Concepto | Costo | Hito |
|---|---|---|
| Pasajes Santiago–CDMX (2 viajes × $300.000) | $600.000 | H6 |
| Alojamiento + viáticos (10 días total) | $300.000 | H6 |
| Eventos networking en CDMX (Endeavor, asociaciones HR locales) | $100.000 | H6 |
| | **$1.000.000** | |

---

## 3. Hitos del proyecto (carta Gantt simplificada)

```
            Mes 1   Mes 2   Mes 3   Mes 4   Mes 5   Mes 6
H1 SSO     [████████████]
H2 Slack          [████████████]
H3 Content [████████████████████████]
H4 Outbnd         [████████████████████]
H5 ISO27k                [████████████████]
H6 Mexico                       [████████████]
```

### H1 — SSO SAML + SCIM enterprise (M1–M2)

**Objetivo**: habilitar autenticación enterprise (Azure AD, Okta, Google Workspace) y aprovisionamiento automático SCIM.

**Entregables verificables**:
- [ ] Endpoints `/auth/saml/{login,callback,metadata}` operativos
- [ ] SCIM 2.0 endpoint con CRUD de usuarios y grupos
- [ ] Documentación pública en docs.eva360.cl
- [ ] Test de integración con Azure AD trial + Okta sandbox
- [ ] 1 cliente piloto autenticando vía SSO en producción

**Indicador de éxito**: cliente enterprise puede onboarding 200 empleados en <1 hora vía SCIM.

---

### H2 — Integración Slack + MS Teams (M2–M3)

**Objetivo**: notificaciones de evaluaciones, recordatorios de OKRs y reconocimientos en Slack/Teams.

**Entregables verificables**:
- [ ] App de Slack publicada en Slack App Directory (status "approved")
- [ ] App de Teams en Microsoft AppSource (o tenant-private install)
- [ ] Comandos slash `/eva360 feedback @persona` operativos
- [ ] Webhooks de eventos productivos (ciclo iniciado, recordatorio, cierre)
- [ ] Documentación de instalación pública

**Indicador de éxito**: 60% de tasa de respuesta a recordatorios vía Slack vs 25% vía email.

---

### H3 — Landing pública + content + SEO (M1–M4)

**Objetivo**: motor de leads inbound sostenible.

**Entregables verificables**:
- [ ] Landing eva360.ascenda.cl rediseñada con SEO técnico
- [ ] 5 case studies publicados (con permiso del cliente)
- [ ] 12 artículos de blog optimizados para keywords HR Tech LATAM
- [ ] 1.000 sesiones orgánicas/mes al cierre (vs `[[ baseline ]]`)
- [ ] 30 leads/mes capturados desde landing al cierre

**Indicador de éxito**: CAC orgánico <CLP $300.000 (vs $1.500.000 paid).

---

### H4 — Outbound ABM mid-market (M3–M5)

**Objetivo**: pipeline de pilots.

**Entregables verificables**:
- [ ] Lista de 200 cuentas ICP (Apollo + LinkedIn Sales Nav)
- [ ] Sequence de 5 touches outbound por cuenta
- [ ] 10 demos calificadas/mes en M5
- [ ] 3 nuevos clientes pagados firmados (Chile)

**Indicador de éxito**: tasa de conversión demo→cliente ≥30%.

---

### H5 — Auditoría ISO 27001 Etapa 1 (M4–M6)

**Objetivo**: gap analysis y remediación inicial para certificación; abre deals enterprise.

**Entregables verificables**:
- [ ] Gap analysis ISO 27001:2022 completado por consultor externo
- [ ] Plan de remediación con prioridades
- [ ] 80% de controles críticos cerrados (objetivo Etapa 1)
- [ ] Pentest externo aplicado, hallazgos críticos remediados

**Indicador de éxito**: capacidad de presentar evidencias de seguridad a deal enterprise sin bloqueos.

---

### H6 — Pilot México (validación expansión) (M5–M6)

**Objetivo**: validar product-market fit en mercado 10x.

**Entregables verificables**:
- [ ] 2 clientes pagados firmados en CDMX
- [ ] Adaptaciones legales (DPA México, factura CFDI integrada con SAT)
- [ ] Alianza con 1 partner local (consultora HR o reseller)
- [ ] Documento de estrategia LATAM rolling 12 meses

**Indicador de éxito**: pipeline de 8 leads calificados México al cierre del programa.

---

## 4. KPIs globales del programa (cierre M7)

| KPI | Baseline (hoy) | Objetivo M7 |
|---|---|---|
| Clientes pagados | `[[ N ]]` | 15 |
| MRR | `[[ X ]]` | USD $8.000+ |
| ARR proyectado | `[[ X ]]` | USD $96.000+ |
| Churn anual | n/a | <8% |
| NPS | n/a | ≥80 |
| Demos calificadas/mes | `[[ X ]]` | 10+ |
| Empleados en Chile (Ascenda) | `[[ X ]]` | 4–5 (founder + 2 contractors + 1 SDR) |
| Países activos | 1 (Chile) | 2 (Chile + México) |
| Cumplimiento ISO 27001 | 0% | 80% Etapa 1 |

---

## 5. Plan de rendiciones a Corfo

Corfo Build típicamente exige rendiciones cuatrimestrales con boletas, facturas y contratos como respaldo de cada gasto.

**Calendario propuesto**:

| Rendición | Mes | Monto | % avance |
|---|---|---|---|
| Anticipo (al firmar contrato) | M0 | $5.000.000 | 33% |
| 1ª rendición | M3 | rinde $5.000.000 + solicita $5.000.000 | 66% |
| 2ª rendición | M6 | rinde $5.000.000 + solicita $5.000.000 | 100% |
| Cierre técnico y financiero | M7 | informe final | 100% |

> **Importante**: las rendiciones deben usar la plataforma de Corfo y todos los gastos pagarse desde la cuenta corriente de la empresa (Ascenda SpA). **No son elegibles**: pagos en efectivo, transferencias entre cuentas personales, gastos previos a la firma del contrato.

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Convocatoria cierra antes de postular | Media | Alto | Validar fecha de cierre AL MOMENTO de leer este doc; tener postulación lista 2 semanas antes |
| Demos no convierten al ritmo proyectado | Media | Alto | Plan B: doblar inversión en SEO/content (orgánico) + pivot a partnerships |
| Costos cloud crecen >30% por nuevos clientes | Baja | Medio | Negociar startup credits con Render + monitoreo de unit economics |
| Auditoría ISO descubre gaps mayores | Media | Medio | Reservar 20% del presupuesto H5 como buffer |
| Churn temprano de pilots | Media | Alto | Customer success dedicado primeras 8 semanas (incluido en H4) |
| Ley de protección de datos México (LFPDPPP) más restrictiva | Baja | Medio | Asesoría legal incluida en categoría 4 |
