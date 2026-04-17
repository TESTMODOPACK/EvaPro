# CONTRATO DE PRESTACIÓN DE SERVICIOS DE SOFTWARE (SaaS)

**ASCENDA PERFORMANCE SpA** — Plataforma EVA360

---

## ENTRE LAS PARTES

**PROVEEDOR ("Ascenda"):**
- Razón social: **ASCENDA PERFORMANCE SpA**
- RUT: **78.396.131-8**
- Domicilio: Fresia 2020, La Pintana, Santiago, Chile
- Representante legal: **Ricardo Morales Olate**, RUT 12.121.896-8
- Contacto: soporte@ascenda.cl

**CLIENTE ("[NOMBRE ORGANIZACIÓN]"):**
- Razón social: **[NOMBRE ORGANIZACIÓN]**
- RUT: [RUT]
- Domicilio: [DIRECCIÓN]
- Representante legal: **[NOMBRE REPRESENTANTE LEGAL]**, RUT [RUT REPRESENTANTE]

**Fecha de inicio:** [Effective Date]

---

## PRIMERO: OBJETO

El Proveedor pondrá a disposición del Cliente la plataforma **EVA360**, accesible en **eva360.ascenda.cl**, como servicio de software en la nube (SaaS) para la gestión de evaluaciones de desempeño, clima laboral, objetivos y desarrollo del personal.

## SEGUNDO: PLAN Y ALCANCE

- **Plan contratado:** [Plan Name]
- **Máximo de usuarios:** [Max Employees]
- **Período de facturación:** [Billing Period]
- **Precio:** [Price] [Currency] / [Billing Period]

El detalle de funcionalidades del plan puede consultarse en cualquier momento desde la sección "Mi Suscripción" de la plataforma.

## TERCERO: OBLIGACIONES DEL PROVEEDOR

a) Mantener la plataforma disponible con un SLA de 99.5% mensual (ver SLA adjunto)
b) Realizar respaldos diarios de la información del Cliente (ver cláusula QUINTO)
c) Implementar medidas de seguridad según estándares de la industria (cláusula CUARTO)
d) Proporcionar soporte técnico en horario hábil (lunes a viernes, 9:00–18:00 hora Chile)
e) Notificar con 30 días de anticipación cualquier cambio material al servicio
f) Garantizar portabilidad de datos del Cliente en formatos estándar (CSV, Excel, PDF)
g) Cumplir con la Ley 19.628 sobre Protección de Datos Personales

## CUARTO: INFRAESTRUCTURA Y PLATAFORMA TECNOLÓGICA

La plataforma EVA360 se ejecuta sobre la siguiente infraestructura y stack tecnológico:

a) **Infraestructura:** servidor virtual privado (VPS) en Hostinger, con aislamiento de red y recursos dedicados.
b) **Orquestación:** Docker Compose administra los componentes (base de datos, API, frontend, reverse proxy Nginx).
c) **Stack de aplicación:** NestJS 11 (API), Next.js 14 (frontend), PostgreSQL 16 (base de datos relacional).
d) **Dominio y cifrado:** eva360.ascenda.cl con certificado TLS válido (Let's Encrypt) renovable automáticamente.
e) **Arquitectura multi-tenant:** aislamiento lógico de datos por `tenant_id`. Ninguna organización puede acceder a datos de otra.
f) **Autenticación:** JWT con expiración configurable, 2FA/TOTP opcional, SSO OIDC para clientes enterprise.
g) Registro de auditoría inmutable de todas las operaciones críticas.

## QUINTO: POLÍTICA DE RESPALDOS Y CONTINUIDAD OPERATIVA

El Proveedor ejecuta respaldos automáticos de la base de datos con las siguientes características:

a) **Frecuencia:** respaldo completo diario a las 03:00 AM hora Chile.
b) **Formato:** `pg_dump` formato custom con compresión máxima.
c) **Retención local:** 30 días rotativos en el mismo servidor.
d) **Retención off-site:** almacenamiento cifrado en proveedor independiente (Cloudflare R2, Backblaze B2 o similar).
e) **Verificación:** test de restore a base de datos temporal mensualmente.
f) **RPO** (Recovery Point Objective): máximo 24 horas. En caso de catástrofe, la pérdida de datos no excederá las 24 horas previas al incidente.
g) **RTO** (Recovery Time Objective): máximo 4 horas. El servicio será restablecido dentro de este plazo.

## SEXTO: SERVICIOS DE TERCEROS (SUBPROCESADORES)

Para prestar el servicio, el Proveedor se apoya en los siguientes subprocesadores. Todos los datos compartidos con ellos se tratan conforme a esta cláusula y al DPA adjunto.

a) **Hostinger** — Infraestructura VPS (Europa / Latinoamérica).
b) **Resend** — Envío de correo transaccional (notificaciones, invitaciones, recordatorios).
c) **Stripe** — Procesamiento de pagos con tarjeta (mercados internacionales), cuando aplique.
d) **MercadoPago** — Procesamiento de pagos (Latinoamérica), cuando aplique.
e) **Cloudinary** — Almacenamiento de archivos adjuntos (CVs, exports GDPR).
f) **Anthropic (Claude)** — Análisis con inteligencia artificial para generación de resúmenes, detección de sesgos y sugerencias de desarrollo. Habilitado solo si el Cliente activa la funcionalidad de IA.
g) **Cloudflare / Let's Encrypt** — CDN y certificados TLS.

El Cliente reconoce que el uso de estos subprocesadores puede implicar transferencia internacional de datos, siempre bajo las salvaguardas contractuales equivalentes a las de este contrato.

## SÉPTIMO: OBLIGACIONES DEL CLIENTE

a) Pagar oportunamente las tarifas del plan contratado
b) Usar la plataforma conforme a los Términos y Condiciones de Uso
c) Mantener la confidencialidad de las credenciales de acceso de sus usuarios
d) No intentar acceder a datos de otras organizaciones
e) Designar un administrador responsable del sistema
f) Garantizar que los datos personales ingresados cuenten con el consentimiento de sus titulares
g) Notificar al Proveedor cualquier incidente de seguridad detectado

## OCTAVO: PAGOS Y FACTURACIÓN

a) **La facturación es MENSUAL** y se cobra anticipadamente el primer día de cada mes calendario (o al momento de la contratación si es mitad de mes, con prorrateo proporcional solo del primer cobro).

b) **El pago es NO REEMBOLSABLE.** Si el Cliente decide terminar el servicio antes del fin del mes ya facturado, el servicio continuará funcionando normalmente hasta el último día del mes pagado. **NO habrá reembolso parcial** ni prorrateo del período no utilizado.

c) **Cancelación:** el Cliente debe notificar con al menos 5 días de anticipación al cierre del mes para que la baja sea efectiva ese mes. Si la notificación llega con menos anticipación, la baja se efectúa al cierre del mes siguiente (sujeta al cobro regular de ese mes).

d) **Mora:** pagos atrasados más de 15 días generan suspensión del servicio hasta la regularización. Mora de 30 días habilita al Proveedor a terminar el contrato sin responsabilidad.

e) **Facturación electrónica:** facturas emitidas en formato electrónico válido para el Servicio de Impuestos Internos (SII) de Chile.

f) **Renovación automática:** el contrato se renueva mensualmente por períodos sucesivos salvo cancelación conforme al literal (c).

## NOVENO: PROTECCIÓN DE DATOS PERSONALES

Las partes se comprometen a cumplir la Ley 19.628 sobre Protección de la Vida Privada y sus modificaciones. El tratamiento de datos personales de los colaboradores del Cliente se rige por el **Acuerdo de Procesamiento de Datos (DPA)** adjunto, el cual forma parte integral de este contrato.

El Proveedor actuará exclusivamente como **Encargado del Tratamiento**. El Cliente es el **Responsable del Tratamiento** y debe garantizar la licitud de la recopilación de datos.

## DÉCIMO: PROPIEDAD INTELECTUAL

La plataforma EVA360, su código fuente, diseño, documentación y marca son propiedad exclusiva de Ascenda Performance SpA. El Cliente no adquiere derechos de propiedad intelectual sobre el software.

El Cliente retiene la propiedad exclusiva de todos los datos ingresados en la plataforma por sus usuarios. El Proveedor no usará estos datos para fines distintos a la prestación del servicio.

## UNDÉCIMO: VIGENCIA Y TERMINACIÓN

Este contrato tiene vigencia desde la Fecha de Inicio por períodos mensuales renovables automáticamente según la cláusula OCTAVO (f). Al término del contrato:

- El Proveedor exportará todos los datos del Cliente en formato estándar dentro de 30 días calendario
- Los datos del Cliente serán eliminados de los servidores del Proveedor dentro de 60 días posteriores a la exportación
- Las cuentas de usuario serán desactivadas en la fecha de término

## DUODÉCIMO: LIMITACIÓN DE RESPONSABILIDAD

La responsabilidad máxima del Proveedor por cualquier reclamo derivado de este contrato se limita al monto total pagado por el Cliente en los últimos 12 meses de servicio.

El Proveedor no será responsable por: (a) daños indirectos, incidentales o consecuentes; (b) pérdida de datos causada por acciones del Cliente; (c) interrupciones causadas por factores externos (internet, infraestructura del Cliente, proveedores de pago, terceros).

## DÉCIMO TERCERO: RESOLUCIÓN DE CONTROVERSIAS

Las partes procurarán resolver cualquier controversia de forma directa y amistosa. En caso de no llegar a acuerdo, se someterá a arbitraje conforme al Reglamento del Centro de Arbitraje y Mediación de Santiago.

## DÉCIMO CUARTO: DOCUMENTOS INTEGRANTES

Forman parte integral de este contrato:
1. Acuerdo de Procesamiento de Datos (DPA)
2. Términos y Condiciones de Uso
3. Política de Privacidad
4. Acuerdo de Nivel de Servicio (SLA)
5. Acuerdo de Confidencialidad (NDA)

---

## FIRMAS

**POR EL PROVEEDOR — ASCENDA PERFORMANCE SpA**
Firma: ________________________
Nombre: Ricardo Morales Olate
RUT: 12.121.896-8
Fecha: ________________________

**POR EL CLIENTE — [NOMBRE ORGANIZACIÓN]**
Firma: ________________________
Nombre: [NOMBRE REPRESENTANTE LEGAL]
RUT: [RUT REPRESENTANTE]
Fecha: ________________________
