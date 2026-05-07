# EVA360 — Presentación Institucional

> **Audiencia**: nuevos usuarios + inversionistas
> **Formato**: 14 slides · 7–10 minutos de exposición
> **Versión**: 1.0 — Mayo 2026
> **Empresa**: Ascenda SpA · Santiago, Chile
> **Producto**: [eva360.ascenda.cl](https://eva360.ascenda.cl)

---

## Slide 1 — Portada

# EVA360
### La plataforma de gestión del desempeño con Inteligencia Artificial para empresas LATAM

**Una sola plataforma. Todo el ciclo de personas. IA integrada.**

Ricardo Ascenda — Founder & CEO
Ascenda SpA · Santiago, Chile

📧 ricardo@ascenda.cl · 🌐 [ascenda.cl](https://ascenda.cl)

---

## Slide 2 — El problema que resolvemos

> **Las empresas evalúan a sus personas mal, tarde y caro.**

- **78%** de los empleados desconfía de la evaluación de desempeño tradicional *(Gallup, 2024)*.
- Procesos manuales en Excel y Google Forms generan **sesgo del evaluador**, baja participación y datos no accionables.
- Las pymes y empresas medianas en LATAM **no pueden pagar** soluciones enterprise como Workday, Lattice o Culture Amp (USD $20–50/empleado/mes).
- Resultado: **rotación 25% mayor**, planes de desarrollo (PDI) que nunca se ejecutan y líderes que toman decisiones a ciegas.

> **Insight clave**: el problema no es la falta de herramientas — es que las herramientas existentes no fueron diseñadas para empresas latinoamericanas de 50–500 empleados.

---

## Slide 3 — Qué es EVA360

**EVA360** es una plataforma SaaS B2B integral que reemplaza Excel + 4 herramientas separadas con un solo sistema, potenciada con IA generativa.

### Una plataforma. Todo el ciclo del talento.

| Módulo | Reemplaza |
|---|---|
| 🎯 Evaluaciones 360° configurables | Google Forms + Excel |
| 📈 OKRs y objetivos con seguimiento | Lattice / Asana |
| 💬 Feedback continuo + 1-on-1 | Notion + reuniones improvisadas |
| 🌱 Planes de Desarrollo Individual (PDI) | PDFs en SharePoint |
| 🌡️ Encuestas de clima + mood check-ins | SurveyMonkey |
| 🏆 Reconocimientos y badges | Kudos / nada |
| 🤖 **Insights con IA (Claude)** | *Ningún competidor lo hace a este precio* |
| 🧮 Calibración + 9-box + analytics | Excel "calibration meeting" |
| 📋 Reclutamiento + ATS + postulantes | Lever / Greenhouse |
| 🤝 Reuniones de equipo + agendas | Notion / Google Docs |

---

## Slide 4 — Demo del producto (lo que ya funciona hoy)

### Producto operativo en producción

- **39 controllers** activos en backend (NestJS 11)
- **30+ páginas** de UI funcional en producción (Next.js 14)
- **78 entidades** de dominio modeladas
- **Multi-tenant** con Row-Level Security (RLS) en PostgreSQL
- **Integración productiva** con Anthropic Claude SDK
- **PWA instalable** + push notifications nativas
- **2FA**, JWT, auditoría cross-tenant
- **Suscripciones, planes y add-ons IA** con Stripe + MercadoPago
- **Documentación legal completa**: T&C, DPA, SLA, NDA, Política de Privacidad

> **URL demo**: `https://eva360.ascenda.cl/demo` *(usuario `admin@evapro.demo`)*

---

## Slide 5 — La experiencia del usuario final

### Para el colaborador
- Dashboard personal con sus evaluaciones, objetivos, feedback y PDI.
- Mood check-ins semanales que toman 10 segundos.
- Reconocimientos públicos para celebrar logros del equipo.
- Notificaciones inteligentes (no spam): solo cuando hay algo accionable.

### Para el líder
- Vista 360° de su equipo: desempeño, riesgo de fuga, objetivos atrasados.
- Streaks de liderazgo: gamificación de hábitos de gestión sanos.
- 1-on-1 estructurados con agenda automática y notas IA.
- Calibración asistida con 9-box y analytics de equipo.

### Para RR.HH.
- Ciclos de evaluación lanzados en minutos, no semanas.
- Plantillas configurables por cargo, área o nivel.
- Insights agregados: brecha de competencias, DEI, rotación, NPS interno.
- Auditoría completa: quién evaluó a quién, cuándo y con qué calificación.

---

## Slide 6 — Diferencial técnico: IA con Claude integrada de forma nativa

EVA360 no es una herramienta con un "chatbot pegado". La IA está embebida en los flujos críticos:

- **Análisis de feedback no estructurado** → competencias accionables.
- **Generación de PDI personalizado** a partir de fortalezas y brechas detectadas.
- **Alertas tempranas de riesgo de fuga** basadas en señales mood + desempeño.
- **Resúmenes ejecutivos automáticos** de ciclos completos.
- **Sugerencias de objetivos OKR** alineados con la estrategia organizacional.
- **Análisis DEI** con detección de sesgo en evaluaciones.

**Modelo de costos transparente**: add-on por créditos IA (no incluido en plan base), evita inflación de precios y cliente solo paga lo que usa.

---

## Slide 7 — Arquitectura y seguridad enterprise

| Capa | Stack | Garantía |
|---|---|---|
| Frontend | Next.js 14 + React + TypeScript | PWA, SEO, performance |
| Backend | NestJS 11 + TypeORM | API REST documentada |
| Base de datos | PostgreSQL con **Row-Level Security** | Aislamiento multi-tenant |
| IA | Anthropic Claude SDK | Privacidad: no se entrena con datos del cliente |
| Pagos | Stripe + MercadoPago | Ready para Chile + LATAM |
| Auth | JWT + 2FA + SSO (roadmap) | Compatible con Azure AD / Okta |
| Observabilidad | Sentry + métricas internas | SLA medible |
| Cumplimiento | DPA + Política Privacidad + RLS | GDPR-ready |

> **Multi-tenant real**: cada cliente tiene aislamiento de datos a nivel base de datos, no solo a nivel aplicación. Imposible filtrar datos entre tenants.

---

## Slide 8 — Mercado y oportunidad

### TAM / SAM / SOM

| Métrica | Cifra | Fuente |
|---|---|---|
| **TAM** — HR Tech LATAM | USD $4.8B (2025) | Gartner / Statista |
| **SAM** — SaaS desempeño LATAM mid-market | USD $620M | Mordor Intelligence |
| **SOM (3 años)** — Chile + México + Colombia | USD $18M | Estimación bottom-up |

### Cliente ideal (ICP)
- 50–500 empleados.
- Sectores: servicios, retail, fintech, salud privada.
- Países: Chile, México, Colombia, Perú.
- Pain validado: ya intentaron con Excel y fracasaron.

### Tendencia
HR Tech LATAM crece **17% CAGR** (vs 9% global), impulsado por digitalización post-COVID y nueva regulación laboral en Chile (Ley 40 horas, NCh 3262 de bienestar laboral).

---

## Slide 9 — Competencia y ventaja defendible

| Competidor | Precio/empleado/mes | IA | Multi-tenant LATAM | Idioma local |
|---|---|---|---|---|
| Lattice (US) | USD $11 | Limitada | ❌ | ❌ |
| Culture Amp (AU) | USD $14 | ❌ | ❌ | ❌ |
| Bamboo HR | USD $9 | ❌ | ❌ | Parcial |
| Buk (CL) | UF 0.4 + módulos extra | ❌ | ✅ | ✅ |
| Rankmi (CL) | A consultar | Limitada | ✅ | ✅ |
| **EVA360** | **CLP $1.500–4.000** | ✅ Claude nativa | ✅ RLS | ✅ es/en/pt |

### Tres ventajas defendibles
1. **Precio 3–5x menor** que competidores US, ajustado al poder de compra LATAM.
2. **IA generativa nativa** (no add-on caro): insights automáticos en feedback, competencias y PDI.
3. **Stack moderno + arquitectura multi-tenant** que escala sin rehacer.

---

## Slide 10 — Modelo de negocio

### Revenue stream principal — SaaS B2B por número de empleados

| Plan | Empleados | Precio mensual (CLP) | ARR esperado |
|---|---|---|---|
| Starter | hasta 50 | $200.000 | $2.4M |
| Growth | hasta 200 | $800.000 | $9.6M |
| Business | hasta 500 | $2.000.000 | $24M |
| Enterprise | 500+ | Custom (UF) | $50M+ |

### Revenue stream secundario — Add-on IA por créditos
- Pack 100 créditos: CLP $50.000
- Pack 500 créditos: CLP $200.000

### Unit economics objetivo (mes 18)
- **CAC**: CLP $800.000
- **LTV**: CLP $14.000.000
- **LTV/CAC**: **17.5x**
- **Payback**: 4 meses
- **Gross margin**: 78%

---

## Slide 11 — Tracción y estado actual

### Producto
- ✅ Plataforma operativa con 39 controllers + 30 páginas UI.
- ✅ 78 entidades de dominio modeladas.
- ✅ Integración productiva con Anthropic Claude.
- ✅ Documentación legal completa (T&C, DPA, SLA, NDA, Privacidad).
- ✅ PWA + push notifications + 2FA + auditoría.
- ✅ Multi-tenant con Row-Level Security validado.

### Comercial *(actualizar al momento de presentar)*
- `[[ N ]]` tenants demo activos
- `[[ N ]]` clientes pagados (pilots o suscripción)
- `[[ MRR ]]` MRR
- `[[ N ]]` leads en pipeline desde landing pública

### Hitos próximos (12 meses)
- SSO SAML + SCIM (Azure AD, Okta, Google Workspace)
- Integraciones Slack + Microsoft Teams
- Certificación ISO 27001 (Etapa 1)
- Expansión piloto México (CDMX)

---

## Slide 12 — Roadmap a 12 meses

| Hito | Trimestre | Resultado verificable |
|---|---|---|
| H1 — SSO SAML + SCIM enterprise | Q1 | Compatible con Azure AD + Okta + Google Workspace |
| H2 — Integraciones Slack + Teams | Q2 | App publicada en Slack Marketplace |
| H3 — Landing producto + SEO + content | Q1–Q2 | 5 case studies + 1.000 sesiones/mes orgánicas |
| H4 — Outbound + ABM mid-market | Q2–Q3 | 10 demos calificadas/mes + 3 pilots cerrados |
| H5 — ISO 27001 (Etapa 1) | Q3 | Auditoría inicial completada |
| H6 — Internacionalización México | Q3–Q4 | 2 clientes en CDMX cerrados |
| H7 — App móvil nativa iOS/Android | Q4 | App publicada en App Store + Play Store |
| H8 — API pública + Marketplace | Q4 | 3 integraciones de partners activas |

### KPIs cierre año 1
- 15+ clientes pagados · MRR USD $8.000+ · NPS 80 · 1 partnership estratégico.

---

## Slide 13 — Equipo y por qué nosotros

### Ricardo Ascenda — Founder, CEO & CTO
- `[[ Resumen 3 líneas: experiencia previa, dominios técnicos, por qué EVA360 ]]`
- LinkedIn: `[[ url ]]`

### Equipo técnico
- **Backend Engineer** — NestJS / TypeORM / PostgreSQL
- **Full-stack Engineer** — Next.js / React / TypeScript

### Advisors *(opcional)*
- `[[ pendiente: 1–2 advisors del ecosistema HR o SaaS LATAM ]]`

> **Por qué somos los indicados**: combinamos experiencia técnica enterprise con conocimiento profundo del mercado HR LATAM. Ya construimos lo difícil — multi-tenant, IA, ciclos completos de evaluación. Ahora aceleramos lo comercial.

---

## Slide 14 — Cierre y llamado a la acción

### Para nuevos usuarios
> Empieza a evaluar a tu equipo de forma justa, rápida y con datos accionables. **Demo gratuita en 15 minutos** y onboarding asistido en menos de una semana.

### Para inversionistas
> EVA360 ya existe. Funciona. Lo difícil está hecho.
> Estamos levantando capital semilla para acelerar **go-to-market en Chile + México** y consolidar tracción regional en 18 meses.

### Pedimos
- Inversionistas: ronda semilla `[[ monto ]]` — usos: comercial + expansión + ISO 27001.
- Clientes: agendar demo personalizada con tu equipo de RR.HH.
- Partners: integraciones (ERP, payroll, consultoras HR).

### Contacto
📧 ricardo@ascenda.cl · 🌐 [ascenda.cl](https://ascenda.cl) · 🇨🇱 Santiago, Chile
🔗 [eva360.ascenda.cl](https://eva360.ascenda.cl)

---

## Notas para diseñar el deck visualmente

- **Tono**: profesional, sobrio, datos > palabras.
- **Tipografía**: Inter o IBM Plex Sans (libres de licencia).
- **Colores**: paleta del logo EVA360 (`docs/eva360_logo_principal_dark.png`).
- **Capturas**: incluir 3–4 screenshots reales del producto en slides 4, 5 y 6.
- **Formato final**: PDF + Keynote/Slides para presentación oral.
- **Tiempo objetivo**: 7–10 minutos + 5 minutos de Q&A.
- **Adaptar audiencia**:
  - **Solo usuarios** → enfatizar slides 3, 5, 6, 14. Acortar 8–10.
  - **Solo inversionistas** → enfatizar slides 2, 8, 9, 10, 11, 12. Acortar 5.
  - **Mixta** → presentar completa.
