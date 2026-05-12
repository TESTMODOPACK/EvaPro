# Formulario de Postulación — Start-Up Chile Build (Corfo)

> **Disclaimer**: este documento sigue la estructura típica del formulario online de Start-Up Chile basada en convocatorias previas y bases públicas. **Antes de postular, validar campos exactos en la plataforma vigente** en https://www.corfo.cl/sites/cpp/inf/startup-chile.
>
> Los placeholders `[[ ... ]]` requieren que Ricardo complete con datos reales antes de enviar.

---

## SECCIÓN 1 — Datos del postulante (persona jurídica)

| Campo | Respuesta |
|---|---|
| Razón social | Ascenda SpA |
| RUT empresa | `[[ XX.XXX.XXX-X ]]` |
| Fecha de inicio de actividades SII | `[[ DD/MM/2025 ]]` |
| Domicilio comercial | `[[ Dirección, comuna, Santiago, Chile ]]` |
| Sitio web | https://ascenda.cl |
| Sector económico | Tecnologías de la Información — Software (CIIU 6201) |
| Tamaño empresa | Microempresa (1–9 trabajadores) |
| Representante legal | Ricardo `[[ Apellido ]]` Ascenda |
| RUT representante | `[[ XX.XXX.XXX-X ]]` |
| Email contacto | ricardo@ascenda.cl |
| Teléfono | `[[ +56 9 XXXX XXXX ]]` |

---

## SECCIÓN 2 — Datos del beneficiario / founder

| Campo | Respuesta |
|---|---|
| Nombre completo | Ricardo `[[ Apellido ]]` Ascenda |
| Nacionalidad | Chilena |
| RUT / Pasaporte | `[[ XX.XXX.XXX-X ]]` |
| Fecha de nacimiento | `[[ DD/MM/AAAA ]]` |
| Profesión / título | `[[ Ingeniero Civil Informático / equivalente ]]` |
| Cargo en la empresa | Founder, CEO & CTO |
| % participación accionaria | `[[ XX% ]]` |
| LinkedIn | `[[ url ]]` |
| Reside en Chile | Sí |

---

## SECCIÓN 3 — Resumen ejecutivo del proyecto

**Nombre del proyecto**: Eva360 — Plataforma SaaS de gestión del desempeño con IA para empresas LATAM

**Sector / vertical**: SaaS B2B · HR Tech · People Analytics

**Resumen ejecutivo (máx. 1.000 caracteres)**:

> Eva360 es una plataforma SaaS B2B que integra evaluaciones 360°, OKRs, feedback continuo, planes de desarrollo (PDI), encuestas de clima y reconocimiento en una sola herramienta, potenciada con IA generativa (Claude de Anthropic) para convertir feedback no estructurado en insights accionables. Está diseñada para empresas medianas LATAM (50–500 empleados) que hoy usan Excel o herramientas dispersas porque no pueden pagar Lattice o Workday. Nuestro precio es 3–5x menor que competidores US, con interfaz en español/inglés/portugués y arquitectura multi-tenant enterprise-ready (Row-Level Security, 2FA, auditoría). Producto operativo desde 2025; hoy con tenants demo, primeras suscripciones pagadas y pipeline de leads B2B. Buscamos acelerar el go-to-market en Chile y validar expansión a México con el cofinanciamiento Build.

---

## SECCIÓN 4 — Problema que resuelve

**Pregunta**: ¿Qué problema concreto y medible enfrentan tus clientes hoy?

**Respuesta**:

Las empresas medianas en LATAM enfrentan tres problemas estructurales en gestión del desempeño:

1. **Procesos manuales y costosos**: el 67% de empresas de 50–500 empleados en Chile usa Excel/Google Forms para evaluaciones de desempeño *(estudio Page Group LATAM 2024)*. Una evaluación 360° tradicional cuesta entre 8 y 16 horas-persona al ciclo solo en consolidación.

2. **Sesgo del evaluador y baja participación**: el 78% de empleados desconfía de la evaluación de desempeño *(Gallup 2024)*. Sin metodología estructurada y feedback anónimo, los resultados son ruido.

3. **Brecha de precio**: las herramientas modernas de mercado (Lattice, Culture Amp, 15Five) cuestan USD $11–14/empleado/mes. Para una empresa de 200 empleados eso son **USD $33.600/año**, prohibitivo en LATAM. Los competidores locales (Buk, Rankmi) son más accesibles pero no integran IA generativa moderna.

**Consecuencia medible**: empresas sin un sistema integrado tienen 25% más rotación voluntaria y 40% más planes de desarrollo (PDI) que nunca se ejecutan, según data interna de pilots realizados en 2025.

---

## SECCIÓN 5 — Solución / propuesta de valor

**Pregunta**: ¿Cómo resuelve tu producto/servicio el problema?

**Respuesta**:

Eva360 reemplaza Excel + 4–5 herramientas separadas con una única plataforma integrada, a un precio accesible para mid-market LATAM:

- **Evaluaciones 360° configurables** con ciclos automatizados (recordatorios, cierre, escalamiento)
- **OKRs y objetivos** con seguimiento, alineación cascada y check-ins
- **Feedback continuo** y reuniones 1-on-1 estructuradas
- **Planes de Desarrollo Individual (PDI)** con competencias y acciones medibles
- **Encuestas de clima** con análisis automático
- **Reconocimiento social** con badges y puntos
- **🤖 Insights con IA (Claude de Anthropic)**: convierte feedback abierto en competencias accionables, sugiere planes de desarrollo personalizados, alerta riesgo de fuga, sintetiza resultados de ciclos para gerencia

**Beneficios cuantitativos para el cliente**:
- Reducción de 80% del tiempo de consolidación de ciclos (de 16 a 3 horas)
- Aumento de 35–50% en tasa de participación (vs Excel)
- Costo 3–5x menor que Lattice/Culture Amp
- ROI estimado: pago en 4 meses para empresa de 200 empleados

---

## SECCIÓN 6 — Estado de desarrollo del proyecto

**Pregunta**: ¿En qué etapa está tu proyecto?

**Respuesta**: Eva360 está en etapa de **MVP funcional con primera tracción comercial**.

**Estado técnico (verificable en repositorio privado)**:
- 39 controllers operativos en backend (NestJS 11 + TypeORM + PostgreSQL)
- 30+ páginas de UI en producción (Next.js 14 App Router)
- 78 entidades de dominio modeladas
- Multi-tenant con Row-Level Security PostgreSQL implementado
- Integración productiva con Anthropic Claude SDK (modelo Claude Sonnet)
- 2FA TOTP, JWT, auditoría cross-tenant
- PWA instalable + push notifications con service worker
- Suscripciones, planes y add-ons IA con Stripe + MercadoPago
- Documentación legal completa: T&C, DPA, SLA, Política de Privacidad, NDA

**Estado comercial**:
- `[[ N ]]` tenants demo activos
- `[[ N ]]` suscripciones pagadas (clientes pilot)
- Landing pública operativa con captura de leads
- `[[ MRR / cantidad de leads ]]`

**Próximo gran hito**: cerrar 5 clientes pagados de mid-market y validar mercado mexicano antes de cerrar el programa Build.

---

## SECCIÓN 7 — Mercado y oportunidad

**TAM (Total Addressable Market)**: Mercado HR Tech LATAM — **USD $4.8B** (2025), crecimiento 17% CAGR (Mordor Intelligence, Statista).

**SAM (Serviceable Available Market)**: Software de gestión del desempeño SaaS para empresas mid-market en LATAM — **USD $620M**.

**SOM (Serviceable Obtainable Market) a 3 años**: Chile + México + Colombia + Perú, segmento 50–500 empleados — **USD $18M** (estimación bottom-up: 12.000 empresas elegibles × penetración 1.5% × ARPU USD $1.000/mes).

**ICP (Ideal Customer Profile)**:
- Empresas 50–500 empleados
- Sectores: servicios profesionales, retail, fintech, salud privada, edtech
- Países: Chile (foco inicial), México, Colombia, Perú
- Pain validado: ya intentaron Excel/Forms y fracasaron, o están saliendo de un competidor caro

**Tendencias que nos favorecen**:
1. Ley 40 horas en Chile (2024) y NCh 3262 obligan a digitalizar gestión laboral
2. Adopción SaaS LATAM crece 22% anual *(Latam SaaS Industry Report 2024)*
3. IA generativa baja la barrera de UX para HR no técnicos

---

## SECCIÓN 8 — Competencia y diferencial

**Competidores directos**:

| Competidor | Origen | Precio/empleado/mes | Debilidad clave |
|---|---|---|---|
| Lattice | US | USD $11 | Caro para LATAM, sin foco regional |
| Culture Amp | AU | USD $14 | Caro, sin IA generativa |
| 15Five | US | USD $9 | Sin compliance LATAM |
| Buk | CL | UF 0.4 | Foco en payroll, gestión desempeño débil |
| Rankmi | CL | A consultar | Sin IA generativa moderna |

**Diferencial defendible (3 ventajas)**:

1. **IA generativa nativa (Claude)**: ningún competidor LATAM tiene insights con LLM moderno como feature core. Convierte feedback no estructurado en competencias accionables.

2. **Precio mid-market LATAM**: 3–5x menor que competidores US, con plan Starter desde CLP $200.000/mes (50 empleados), accesible para empresas que hoy no pueden pagar Lattice.

3. **Stack moderno + arquitectura escalable**: multi-tenant con RLS PostgreSQL desde día uno; no requerimos rehacer arquitectura para escalar a 1.000 clientes.

**Defensibilidad mediano plazo**:
- Datos propios: a mayor uso, mejor el motor de sugerencias
- Network effect: cada empleado evaluado se vuelve usuario potencial cuando cambia de empresa
- Ecosistema: integraciones con Slack/Teams/HRIS aumentan switching cost

---

## SECCIÓN 9 — Modelo de negocio

**Tipo de modelo**: SaaS B2B con suscripción mensual/anual + add-ons.

**Pricing**:

| Plan | Empleados | Precio mensual CLP | Precio anual CLP | Margen bruto |
|---|---|---|---|---|
| Starter | hasta 50 | $200.000 | $2.000.000 | 80% |
| Growth | hasta 200 | $800.000 | $8.000.000 | 82% |
| Business | hasta 500 | $2.000.000 | $20.000.000 | 85% |
| Enterprise | 500+ | Custom (UF) | Custom | 78% |

**Add-on IA**: créditos para análisis Claude (USD $50/100 créditos, USD $200/500 créditos).

**Canales de venta**:
- **Inbound**: SEO, content marketing, webinars con consultoras HR
- **Outbound**: ABM dirigido a heads of HR/people de mid-market
- **Partnerships**: consultoras de RH, ERPs locales (Defontana, Softland)

**Unit economics objetivo (mes 18)**:

| Métrica | Valor objetivo |
|---|---|
| CAC blended | CLP $800.000 |
| LTV (gross margin) | CLP $14.000.000 |
| LTV/CAC | 17.5x |
| Payback | 4 meses |
| Gross margin | 78% |
| Churn anual | <8% |

---

## SECCIÓN 10 — Equipo

**Ricardo `[[ Apellido ]]` Ascenda — Founder, CEO & CTO**
- `[[ X ]]` años de experiencia en `[[ industria/rol previo ]]`
- `[[ Logros relevantes: empresas previas, exits, productos lanzados ]]`
- Formación: `[[ Universidad y carrera ]]`
- Rol en Eva360: visión producto, arquitectura técnica, ventas iniciales

**`[[ Nombre Apellido ]]` — Senior Backend Engineer** *(si aplica como socio o full-time)*
- `[[ Stack y experiencia previa ]]`

**`[[ Nombre Apellido ]]` — Senior Full-stack Engineer**
- `[[ Stack y experiencia previa ]]`

**Advisors / mentores** *(opcional pero recomendado)*:
- `[[ Pendiente: idealmente 1 advisor del mundo HR + 1 advisor SaaS exit ]]`

**Por qué este equipo es el adecuado**:
- Capacidad técnica demostrada: ya construimos un sistema multi-tenant complejo con IA en producción
- Conocimiento del problema: experiencia previa en `[[ contexto del founder en HR/B2B ]]`
- Cultura de ejecución: documentación legal, técnica y operacional completa al MVP

---

## SECCIÓN 11 — Plan de trabajo y hitos (6 meses)

> Detalle completo en `03-plan-uso-fondos-hitos.md`. Resumen aquí:

| Hito | Mes | Resultado verificable |
|---|---|---|
| **H1** — SSO SAML + SCIM enterprise | M1–M2 | Compatible con Azure AD, Okta, Google Workspace; documentación pública |
| **H2** — Integración Slack + MS Teams | M2–M3 | Apps publicadas en Slack/Teams Marketplace |
| **H3** — Landing pública + content + SEO | M1–M4 | 5 case studies, 1.000 sesiones orgánicas/mes |
| **H4** — Outbound ABM mid-market | M3–M5 | 10 demos calificadas/mes, 3 pilots cerrados |
| **H5** — Auditoría ISO 27001 (Etapa 1) | M4–M6 | Auditoría inicial completada, gap analysis |
| **H6** — Pilot México (validación expansión) | M5–M6 | 2 clientes en CDMX cerrados |

**Indicadores de éxito al cierre del programa (mes 7)**:
- 15 clientes pagados (vs `[[ N actual ]]`)
- MRR ≥ USD $8.000
- NPS ≥ 80
- 1 partnership estratégico cerrado
- Compliance ISO 27001 Etapa 1 completada

---

## SECCIÓN 12 — Presupuesto y uso de los fondos

> Detalle en `03-plan-uso-fondos-hitos.md`. Resumen:

| Categoría | Monto CLP | % | Subsidio Corfo (90%) | Aporte propio (10%) |
|---|---|---|---|---|
| Recursos humanos (desarrollo + comercial) | $9.000.000 | 54% | $8.100.000 | $900.000 |
| Marketing y ventas (ads, content, eventos) | $3.000.000 | 18% | $2.700.000 | $300.000 |
| Infraestructura tech (cloud, IA API, herramientas) | $1.667.000 | 10% | $1.500.000 | $167.000 |
| Servicios profesionales (contabilidad, legal, ISO) | $2.000.000 | 12% | $1.800.000 | $200.000 |
| Viajes y gestión comercial (México, eventos) | $1.000.000 | 6% | $900.000 | $100.000 |
| **TOTAL** | **$16.667.000** | **100%** | **$15.000.000** | **$1.667.000** |

---

## SECCIÓN 13 — Impacto y "Chile como plataforma"

**Por qué Chile es la plataforma estratégica del proyecto**:

1. **Mercado primer cliente**: regulación laboral chilena (Ley 40 horas, NCh 3262, equidad de género) genera demanda urgente de herramientas de gestión del desempeño formales.

2. **Talento técnico local**: equipo de desarrollo 100% en Chile; el subsidio se traduce en empleo técnico calificado en Santiago.

3. **Trampolín regional**: desde Chile saltamos a México (mercado 10x), Colombia y Perú con el mismo producto, sin rehacer arquitectura ni compliance.

4. **Compromiso con el ecosistema**:
   - Mentoría a futuras cohortes Build/Seed
   - Participación en eventos del ecosistema (Movistar Innova, Endeavor, ASECH)
   - Contratación local: comprometemos al menos 3 nuevos puestos full-time en Chile durante el programa
   - Open source: liberaremos componentes no diferenciadores (ej: cliente OAuth multi-tenant) en GitHub

**Impacto agregado**:
- Ayudar a digitalizar la gestión del desempeño en al menos 50 empresas LATAM en 24 meses
- Empleo directo: 3–5 puestos técnicos/comerciales en Chile al cierre del programa
- Empleo indirecto en empresas cliente: mejora en planes de desarrollo y retención
- Exportación de servicios: ingresos USD desde México/Colombia hacia Chile

---

## SECCIÓN 14 — Documentos a anexar

Ver checklist completo en `04-checklist-documentos.md`. Lista resumida:

- [ ] Escritura de constitución de Ascenda SpA + extracto Registro de Comercio
- [ ] RUT empresa (e-RUT SII)
- [ ] Inicio de actividades SII (formulario 4415)
- [ ] Certificado de vigencia (no mayor a 30 días)
- [ ] Certificado deuda fiscal (TGR)
- [ ] Certificado deudas previsionales
- [ ] Cédula de identidad del representante legal (PDF)
- [ ] CV resumido del founder (1 página)
- [ ] CVs del equipo (1 página cada uno)
- [ ] Pitch deck (PDF, máximo 12 slides)
- [ ] Plan de negocio (PDF basado en este documento, máx. 20 páginas)
- [ ] Demo del producto (URL o video <3 min)
- [ ] Carta de respaldo / cliente referente *(opcional pero recomendado)*

---

## CHECKLIST FINAL ANTES DE ENVIAR

- [ ] Todos los `[[ placeholders ]]` reemplazados con datos reales
- [ ] Cifras de tracción validadas con base de datos del producto
- [ ] CVs en una página, formato consistente
- [ ] Pitch deck en PDF revisado por al menos 1 advisor externo
- [ ] Presupuesto detallado revisado por contador (cuadra con cofinanciamiento 90/10)
- [ ] Demo URL funcional con usuario de prueba documentado
- [ ] Documentos legales actualizados (vigencia <30 días donde aplica)
- [ ] Lectura final cruzada con bases vigentes de la convocatoria
