# Notificaciones en EVA360 — Guía de usuario

## Instalar EVA360 como app

### Android (Chrome, Edge)

1. Abre https://eva360.ascenda.cl en Chrome o Edge.
2. En la barra de URL verás un ícono de "instalar" (💻↓) o aparecerá un banner.
3. Toca "Instalar" → EVA360 se agrega a tu home screen.
4. Abre desde el home → se ve como app nativa, sin barra del navegador.

### iPhone / iPad (Safari, iOS 16.4+)

1. Abre https://eva360.ascenda.cl **en Safari** (no en otro navegador).
2. Toca el botón de **Compartir** (icono de cuadrado con flecha hacia arriba).
3. Desplázate y toca **"Agregar a pantalla de inicio"**.
4. Confirma el nombre "EVA360" y toca "Agregar".
5. El ícono aparecerá en tu home.

**Importante:** en iPhone, las notificaciones push **solo funcionan si instalaste EVA360 en el home** (no al abrir en Safari directamente).

### Computador (Chrome, Edge, macOS Safari)

Mismo proceso: botón instalar en la barra de URL → "Instalar" → queda como app en el dock / launchpad.

---

## Activar notificaciones push

1. Abre EVA360 (preferiblemente la versión instalada).
2. Ve a **Perfil** (menú superior derecho) → baja hasta **Notificaciones push**.
3. Toca **"Activar notificaciones"**.
4. El navegador te preguntará si permites notificaciones de EVA360 → toca **"Permitir"**.
5. Listo — verás el toggle activado y tu dispositivo aparecerá en la lista.

## ¿Qué notificaciones recibo?

Por default, al activar push recibes alertas de estos 6 eventos:

| Evento | Cuando recibes |
|---|---|
| Evaluaciones asignadas | Cuando lanza un ciclo y tienes evaluaciones por completar |
| Check-ins 1:1 agendados | Cuando tu encargado te programa un check-in |
| Objetivos por aprobar | Si eres manager, cuando un colaborador propone un objetivo |
| Feedback recibido | Cuando un colega te envía feedback |
| Reconocimientos | Cuando alguien te reconoce públicamente |
| Encuestas de clima | Al lanzarse una nueva encuesta |

En una próxima actualización (v3.0-P1) podrás desactivar tipos específicos desde Perfil.

## Desactivar en este dispositivo

1. Perfil → Notificaciones push → toca **"Desactivar en este dispositivo"**.
2. Tu browser dejará de recibir push de EVA360.
3. Si tienes otros dispositivos suscritos, siguen recibiendo (independientes).

## Bloqueé las notificaciones por error

Si negaste el permiso inicial, el botón "Activar" no funciona. Para reactivar:

### Chrome (desktop)
1. Click en el candado 🔒 junto a la URL.
2. En "Notificaciones" → cambia a "Permitir".
3. Recarga la página.

### Chrome Android
1. Toca el candado 🔒 junto a la URL.
2. "Permisos" → "Notificaciones" → Permitir.
3. Recarga.

### Safari (iOS/macOS)
1. iOS: Configuración → Safari → Sitios web → Notificaciones.
2. macOS: Safari → Preferencias → Sitios web → Notificaciones.
3. Busca eva360.ascenda.cl → Permitir.

---

## Preguntas frecuentes

**¿Las notificaciones consumen datos móviles?**
Sí, mínimamente. Cada notif pesa unos 2-4 KB. 100 notifs al mes = 400 KB aprox.

**¿Funcionan cuando la app está cerrada?**
Sí. El sistema operativo recibe la notif y la muestra aunque EVA360 no esté abierto.

**¿Son privadas?**
El contenido de la notif se cifra extremo a extremo. Ni Google ni Apple pueden leerlo — solo tu dispositivo descifra.

**¿Recibo notifs en varios dispositivos?**
Sí, si activaste push en cada uno (celular + computador, por ejemplo). Cada dispositivo mantiene su propia suscripción.

**¿Puedo silenciarlas de noche?**
En v3.0-P0 no hay UI de quiet hours, pero el backend ya soporta el feature. Se expondrá en v3.0-P1.

**¿Puedo volver a usar email en vez de push?**
Sí — email y push son independientes. Recibes ambos por default. Puedes desactivar push manteniendo email.

**No me llegan notifs aunque las activé.**
1. Verifica que EVA360 aparece en los permisos del browser (ver arriba).
2. En iPhone: verifica que EVA360 está en tu home screen (no en Safari).
3. Avisa al equipo de soporte con tu email y el modelo de dispositivo.

---

_Última actualización: v3.0.0 (abril 2026)_
