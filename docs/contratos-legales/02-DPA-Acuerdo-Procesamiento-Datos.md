# ACUERDO DE PROCESAMIENTO DE DATOS PERSONALES (DPA)

**ASCENDA PERFORMANCE SpA** — Plataforma EVA360

---

## ENTRE LAS PARTES

**ENCARGADO DEL TRATAMIENTO ("Ascenda"):**
- Razón social: **ASCENDA PERFORMANCE SpA**
- RUT: **78.396.131-8**
- Domicilio: Fresia 2020, La Pintana, Santiago, Chile
- Representante legal: **Ricardo Morales Olate**, RUT 12.121.896-8
- Contacto: soporte@ascenda.cl

**RESPONSABLE DEL TRATAMIENTO ("[NOMBRE ORGANIZACIÓN]"):**
- Razón social: **[NOMBRE ORGANIZACIÓN]**
- RUT: [RUT]
- Domicilio: [DIRECCIÓN]
- Representante legal: **[NOMBRE REPRESENTANTE LEGAL]**, RUT [RUT REPRESENTANTE]

**Fecha de inicio:** [Effective Date]

---

En cumplimiento de la **Ley 19.628** sobre Protección de la Vida Privada de Chile, el Proveedor actúa como "Encargado del Tratamiento" y el Cliente como "Responsable del Tratamiento" de los datos personales procesados en la plataforma EVA360.

## 1. DATOS TRATADOS

- **Identificación:** nombre, apellido, RUT, correo electrónico
- **Laborales:** cargo, departamento, fecha de ingreso, jefatura
- **Evaluación:** puntajes, competencias, objetivos, feedback
- **Demográficos** (opcionales para DEI): género, nacionalidad, fecha de nacimiento
- **Clima:** respuestas a encuestas (pueden ser anónimas según configuración)
- **Uso:** registros de actividad, IP, timestamps

## 2. FINALIDAD DEL TRATAMIENTO

Exclusivamente para la prestación del servicio de evaluación de desempeño y gestión del talento contratado por el Responsable. El Encargado **NO usará** los datos para fines de marketing propio, venta a terceros, ni entrenamiento de modelos de IA propios.

## 3. MEDIDAS DE SEGURIDAD

- Cifrado en tránsito (TLS 1.2+) y en reposo (AES-256 para campos sensibles como secretos SSO)
- Autenticación JWT con expiración y versionado para revocación
- Control de acceso basado en roles (RBAC)
- 2FA/MFA opcional con TOTP
- Rate limiting y protección contra fuerza bruta
- Registro de auditoría inmutable
- Respaldos diarios con retención 30 días local + off-site cifrado
- Políticas de contraseña configurables por organización (longitud, complejidad, expiración, historial)

## 4. SUBPROCESADORES

- **Hostinger** (infraestructura VPS)
- **PostgreSQL 16** (base de datos, alojada en el mismo VPS)
- **Resend** (correo transaccional)
- **Stripe, MercadoPago** (procesadores de pago, cuando aplique)
- **Cloudinary** (almacenamiento de archivos)
- **Anthropic Claude** (análisis de IA, solo si la funcionalidad está habilitada por el Responsable)
- **Cloudflare / Let's Encrypt** (CDN y certificados TLS)

El Encargado notificará al Responsable con al menos 15 días de anticipación cualquier cambio de subprocesadores que implique transferencia internacional de datos nueva.

## 5. DERECHOS DE LOS TITULARES (ARCO)

El Responsable es el punto de contacto principal para el ejercicio de derechos de **Acceso, Rectificación, Cancelación y Oposición**. El Encargado colaborará técnicamente para dar respuesta dentro de **15 días hábiles**, incluyendo:

- Export completo de datos del titular (GDPR Art. 15 / Ley 19.628 Art. 12)
- Anonimización o borrado (GDPR Art. 17 / derecho de cancelación)
- Rectificación de inexactitudes

## 6. RETENCIÓN Y ELIMINACIÓN

Los datos se conservan mientras el contrato esté vigente. Al término, el Encargado:

- Exportará los datos en formato estándar dentro de **30 días calendario**
- Eliminará definitivamente los datos del sistema activo dentro de **60 días calendario** posteriores a la exportación
- Los backups aún con datos serán sobrescritos naturalmente en el plazo de retención (máximo 30 días locales + rotación off-site)

## 7. NOTIFICACIÓN DE INCIDENTES DE SEGURIDAD

El Encargado notificará al Responsable cualquier brecha de seguridad dentro de **72 horas** de su detección, incluyendo:

- Naturaleza del incidente
- Categorías y volumen aproximado de datos afectados
- Medidas tomadas y por tomar para mitigar

## 8. AUDITORÍA

El Responsable puede solicitar una auditoría remota (vía videollamada) de las medidas de seguridad del Encargado una vez al año, con al menos 30 días de aviso previo.

---

## FIRMAS

**POR EL ENCARGADO — ASCENDA PERFORMANCE SpA**
Firma: ________________________
Nombre: Ricardo Morales Olate
RUT: 12.121.896-8
Fecha: ________________________

**POR EL RESPONSABLE — [NOMBRE ORGANIZACIÓN]**
Firma: ________________________
Nombre: [NOMBRE REPRESENTANTE LEGAL]
RUT: [RUT REPRESENTANTE]
Fecha: ________________________
