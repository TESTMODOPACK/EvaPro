# ACUERDO DE NIVEL DE SERVICIO (SLA)

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

## 1. DISPONIBILIDAD DEL SERVICIO

**Compromiso:** 99.5% mensual (excluyendo mantenimiento programado).

- Downtime tolerado mensual: máximo 3h 39m (efectivo).

## 2. TIEMPO DE RESPUESTA DE SOPORTE

| Severidad | Descripción | Respuesta |
|-----------|-------------|-----------|
| **Crítico** | Caído total, bloqueo masivo | Dentro de 4 horas hábiles |
| **Alto** | Funcionalidad importante rota | Dentro de 8 horas hábiles |
| **Normal** | Funcionalidad secundaria | Dentro de 24 horas hábiles |
| **Bajo** | Mejora o consulta | Dentro de 48 horas hábiles |

**Horario hábil:** lunes a viernes, 9:00–18:00 hora Chile.

## 3. OBJETIVOS DE RECUPERACIÓN

- **RPO (Recovery Point Objective):** 24 horas. Frente a un desastre, la pérdida máxima de datos será la de las 24 horas previas.
- **RTO (Recovery Time Objective):** 4 horas. El servicio será restablecido en ese plazo.

## 4. RESPALDOS

- **Frecuencia:** diaria (03:00 AM hora Chile)
- **Retención local:** 30 días rotativos
- **Retención off-site:** cifrado en storage independiente, indefinida con rotación según política operativa
- **Verificación:** restore-test mensual a base de datos temporal (no afecta producción)

## 5. COMPENSACIÓN POR INCUMPLIMIENTO DE DISPONIBILIDAD

Si en un mes calendario la disponibilidad cae bajo el 99.5% comprometido, el Cliente tiene derecho a un crédito proporcional al tiempo de inactividad sobre la factura del mes siguiente, calculado como:

**Crédito = (horas de downtime efectivo / horas totales del mes) × factura mensual base**

El crédito no se aplica automáticamente — debe ser solicitado por el Cliente dentro de **30 días calendario** del incidente, con evidencia del downtime (screenshots, timestamps, tickets abiertos).

## 6. EXCLUSIONES

No cuenta como downtime para efectos de este SLA:

a) Mantenimiento programado notificado con al menos 48 horas de anticipación
b) **Fuerza mayor:** desastres naturales, interrupciones de infraestructura de terceros (Hostinger, Cloudflare, proveedores de internet), ataques de denegación de servicio masivos fuera del control del Proveedor
c) Problemas de red o infraestructura del Cliente
d) Uso del servicio contrario a los Términos y Condiciones
e) **Períodos en que el Cliente decidió no usar el servicio** (ver cláusula OCTAVO del Contrato: no hay reembolso por no-uso)

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
