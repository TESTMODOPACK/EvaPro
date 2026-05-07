# Pitch Deck — Eva360 / Ascenda SpA

> **Programa**: Start-Up Chile Build (Corfo) — Convocatoria 2026
> **Formato sugerido**: 12 slides, máximo 5 minutos de exposición
> **Audiencia**: Comité evaluador Corfo + Start-Up Chile

---

## Slide 1 — Portada

**Eva360**
*La plataforma de gestión del desempeño con IA para empresas LATAM*

Ricardo Ascenda — Founder & CEO
Ascenda SpA · Santiago, Chile · 2026
[ascenda.cl](https://ascenda.cl) · [eva360.ascenda.cl](https://eva360.ascenda.cl)

---

## Slide 2 — El problema

**Las empresas evalúan a sus personas mal, tarde y caro.**

- **78%** de empleados desconfía de la evaluación de desempeño tradicional *(Gallup 2024)*
- Procesos manuales en Excel/Forms generan **sesgo del evaluador**, baja participación y datos no accionables
- Las pymes y empresas medianas LATAM **no pueden pagar** soluciones enterprise como Workday, Lattice o Culture Amp (USD $20-50/empleado/mes)
- Resultado: **rotación 25% mayor** y planes de desarrollo (PDI) que nunca se ejecutan

> **Insight**: el problema no es la falta de herramientas — es que las herramientas existentes no fueron diseñadas para empresas latinoamericanas de 50–500 empleados.

---

## Slide 3 — La solución

**Eva360**: una plataforma SaaS B2B integral que reemplaza Excel + 4 herramientas separadas con un solo sistema.

| Módulo | Reemplaza |
|---|---|
| Evaluaciones 360° configurables | Google Forms + Excel |
| OKRs y objetivos con seguimiento | Lattice / Asana |
| Feedback continuo + 1-on-1 | Notion + reuniones improvisadas |
| Planes de Desarrollo Individual (PDI) | PDFs en SharePoint |
| Encuestas de clima | SurveyMonkey |
| Reconocimiento y badges | Kudos / nada |
| **Insights con IA (Claude)** | *Ningún competidor lo hace a este precio* |

**Diferencial técnico**: motor de IA con Claude (Anthropic) que convierte feedback no estructurado en competencias accionables, planes de desarrollo y alertas de riesgo de fuga.

---

## Slide 4 — Demo / Producto en vivo

> *(Slide para presentación: capturas de pantalla o demo en vivo)*

**Lo que ya está funcionando hoy:**
- 39 controllers operativos en backend (NestJS 11)
- 30+ páginas de UI en producción (Next.js 14)
- Multi-tenant con Row-Level Security en PostgreSQL
- Integración productiva con Anthropic Claude SDK
- PWA instalable + push notifications
- 2FA, JWT, auditoría cross-tenant
- Suscripciones, planes y add-ons IA con Stripe + MercadoPago

**URL demo**: `https://eva360.ascenda.cl/demo` *(usuario `admin@evapro.demo`)*

---

## Slide 5 — Mercado

**TAM / SAM / SOM**

| Métrica | Cifra | Fuente |
|---|---|---|
| **TAM** — Mercado HR Tech LATAM | USD $4.8B (2025) | Gartner / Statista |
| **SAM** — SaaS gestión desempeño LATAM mid-market | USD $620M | Mordor Intelligence |
| **SOM (3 años)** — Chile + México + Colombia mid-market | USD $18M | Estimación bottom-up |

**ICP (Ideal Customer Profile)**:
- 50–500 empleados
- Sector servicios, retail, fintech, salud privada
- Chile, México, Colombia, Perú
- Pain validado: ya intentaron Excel y fracasaron

**Tendencia**: mercado HR Tech LATAM crece **17% CAGR** (vs 9% global) por digitalización post-COVID y nueva regulación laboral en Chile (Ley 40 horas, NCh 3262).

---

## Slide 6 — Competencia y diferencial

| Competidor | Precio/empleado/mes | IA | Multi-tenant LATAM | Idioma local |
|---|---|---|---|---|
| Lattice (US) | USD $11 | Limitada | ❌ | ❌ |
| Culture Amp (AU) | USD $14 | ❌ | ❌ | ❌ |
| Bamboo HR | USD $9 | ❌ | ❌ | Parcial |
| Buk (CL) | UF 0.4 + módulos extra | ❌ | ✅ | ✅ |
| Rankmi (CL) | A consultar | Limitada | ✅ | ✅ |
| **Eva360** | **CLP $1.500–4.000** | ✅ Claude integrada | ✅ RLS | ✅ es/en/pt |

**Tres ventajas defendibles**:
1. **Precio 3-5x menor** que competidores US, ajustado a poder de compra LATAM
2. **IA generativa nativa** (no add-on caro): insights automáticos en feedback y competencias
3. **Stack moderno + arquitectura multi-tenant** que escala sin rehacer

---

## Slide 7 — Modelo de negocio

**Revenue stream principal**: SaaS B2B con planes mensuales/anuales por número de empleados

| Plan | Empleados | Precio mensual (CLP) | ARR esperado |
|---|---|---|---|
| Starter | hasta 50 | $200.000 | $2.4M |
| Growth | hasta 200 | $800.000 | $9.6M |
| Business | hasta 500 | $2.000.000 | $24M |
| Enterprise | 500+ | Custom (UF) | $50M+ |

**Revenue stream secundario**: Add-on de IA por créditos (ya implementado)
- Pack 100 créditos: CLP $50.000
- Pack 500 créditos: CLP $200.000

**Métricas unit economics objetivo (mes 18)**:
- CAC: CLP $800.000
- LTV: CLP $14.000.000
- LTV/CAC: **17.5x**
- Payback: 4 meses
- Gross margin: 78%

---

## Slide 8 — Tracción

> **A completar con cifras reales antes de postular**

**Producto**:
- Plataforma operativa con 39 controllers + 30 páginas UI
- 78 entidades de dominio modeladas
- Integración productiva con Anthropic Claude
- Documentación legal completa (T&C, DPA, SLA, NDA, Política de Privacidad)

**Comercial** *(números a la fecha de postulación)*:
- `[[ N ]]` tenants demo activos
- `[[ N ]]` clientes pagados (pilots o suscripción)
- `[[ MRR ]]` MRR
- `[[ N ]]` leads en pipeline desde landing pública

**Reconocimientos / hitos**:
- `[[ pendiente — agregar menciones, posts virales, casos de éxito ]]`

---

## Slide 9 — Equipo

**Ricardo Ascenda** — Founder, CEO & CTO
- `[[ Resumen 3 líneas: experiencia previa, dominios técnicos, por qué eva360 ]]`
- LinkedIn: `[[ url ]]`

**`[[ Nombre ]]`** — Backend Engineer
- `[[ Stack senior NestJS / TypeORM / PostgreSQL ]]`

**`[[ Nombre ]]`** — Full-stack Engineer
- `[[ Next.js / React / TypeScript ]]`

**Advisors / mentores** *(opcional)*:
- `[[ pendiente: agregar 1–2 advisors del ecosistema HR o SaaS ]]`

> **Por qué somos los indicados**: combinamos experiencia técnica enterprise con conocimiento profundo del mercado HR LATAM. Ya construimos lo difícil (multi-tenant, IA, ciclos de evaluación). Build nos permite acelerar lo comercial.

---

## Slide 10 — Roadmap y uso de los fondos

**Plan a 6 meses con CLP $16.667.000 (cofinanciamiento Corfo $15M + aporte propio $1.67M)**:

| Hito | Mes | Inversión | Resultado verificable |
|---|---|---|---|
| H1: SSO SAML + SCIM enterprise | M1–M2 | $4.5M | Compatible con Azure AD + Okta + Google Workspace |
| H2: Integración Slack + Teams | M2–M3 | $3.0M | App publicada en Slack Marketplace |
| H3: Landing producto + SEO + content | M1–M4 | $2.5M | 5 case studies + 1.000 sesiones/mes orgánicas |
| H4: Outbound + ABM mid-market | M3–M5 | $3.0M | 10 demos calificadas/mes + 3 pilots cerrados |
| H5: Certificación ISO 27001 (Etapa 1) | M4–M6 | $2.0M | Auditoría inicial completada |
| H6: Internacionalización (México pilot) | M5–M6 | $1.667M | 2 clientes en CDMX cerrados |

**KPIs de cierre del programa (mes 7)**:
- 15 clientes pagados
- MRR USD $8.000+
- 80 NPS
- 1 partnership estratégico (consultora HR o ERP)

---

## Slide 11 — Por qué Chile es la plataforma correcta

**Cumple con el espíritu del programa "Chile como plataforma":**

1. **Mercado de prueba**: Chile tiene la **mayor adopción SaaS per cápita en LATAM** y regulación laboral exigente que valida la propuesta antes de exportar.
2. **Talento técnico**: empresa fundada en Chile, equipo en Santiago, contratación local.
3. **Expansión natural**: desde Chile saltamos a México (mercado 10x), Colombia y Perú con el mismo producto y compliance.
4. **Compromiso con el ecosistema**: nos comprometemos a participar como mentores en futuras cohortes Build/Seed y a contratar talento local cuando escalemos.

---

## Slide 12 — Ask + cierre

**Pedimos**:
- CLP $15.000.000 de cofinanciamiento Corfo Build
- Acceso a la red de mentores Start-Up Chile
- Conexiones con corporates partners (HR, retail, fintech)

**A cambio entregamos**:
- 6 hitos verificables documentados
- Plataforma escalable con sede en Chile
- Compromiso con el ecosistema (mentoría + contratación local)
- Reportería transparente al gerente Corfo

> **Eva360 ya existe. Funciona. Lo difícil está hecho.**
> **Build nos da el combustible para que pase de "MVP demostrable" a "negocio sostenible con tracción regional" en 6 meses.**

📧 ricardo@ascenda.cl · 🌐 ascenda.cl · 🇨🇱 Santiago, Chile

---

## Notas para diseñar el deck visualmente

- **Tono**: profesional, sobrio, datos > palabras
- **Tipografía**: Inter o IBM Plex Sans (libres de licencia)
- **Colores**: usar la paleta del logo eva360 (`docs/eva360_logo_principal_dark.png`)
- **Capturas**: incluir 2–3 screenshots reales del producto en slides 4 y 7
- **Formato final**: PDF + Keynote/Slides para la presentación oral
- **Tiempo objetivo**: 5 minutos de exposición + 5 minutos de Q&A
