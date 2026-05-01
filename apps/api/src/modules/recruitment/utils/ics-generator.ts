/**
 * S7.2 — Generador minimo de archivos .ics (iCalendar).
 *
 * Crea un buffer iCalendar valido para un slot de entrevista, listo
 * para adjuntar a un email. Compatible con Google Calendar, Outlook,
 * Apple Calendar y cualquier cliente que respete RFC 5545.
 *
 * Uso:
 *   const ics = buildIcs({ uid, scheduledAt, durationMinutes, ... });
 *   await emailService.sendWithAttachments(to, subject, body, [
 *     { filename: 'invite.ics', content: ics, contentType: 'text/calendar; charset=utf-8' }
 *   ]);
 *
 * NO usamos paquete externo (ical-generator, etc) para minimizar
 * dependencias — el formato es simple y solo necesitamos un VEVENT.
 */

export function buildIcs(opts: {
  uid: string;          // ID estable: si re-emitimos por cambios, mismo uid → cliente actualiza el evento.
  scheduledAt: Date;
  durationMinutes: number;
  title: string;        // Asunto del evento
  description?: string; // Detalle, link al meeting, etc.
  location?: string;    // URL del meeting o ubicacion fisica.
  organizerName?: string;
  organizerEmail?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  status?: 'CONFIRMED' | 'CANCELLED'; // CANCELLED para emitir update y borrar el evento.
}): string {
  const dtstamp = formatIcsDate(new Date());
  const dtstart = formatIcsDate(opts.scheduledAt);
  const dtend = formatIcsDate(new Date(opts.scheduledAt.getTime() + opts.durationMinutes * 60 * 1000));
  const status = opts.status ?? 'CONFIRMED';
  const description = (opts.description || '').replace(/\n/g, '\\n');
  const location = (opts.location || '').replace(/\n/g, '\\n');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Eva360//Recruitment//ES',
    'CALSCALE:GREGORIAN',
    status === 'CANCELLED' ? 'METHOD:CANCEL' : 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeIcs(opts.title)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `STATUS:${status}`,
    `SEQUENCE:${status === 'CANCELLED' ? '1' : '0'}`,
  ];
  if (opts.organizerName && opts.organizerEmail) {
    lines.push(`ORGANIZER;CN=${escapeIcs(opts.organizerName)}:mailto:${opts.organizerEmail}`);
  }
  if (opts.attendeeName && opts.attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${escapeIcs(opts.attendeeName)};RSVP=TRUE:mailto:${opts.attendeeEmail}`,
    );
  }
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  // RFC 5545 requiere CRLF.
  return lines.join('\r\n');
}

function formatIcsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ (UTC).
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    'T',
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
    'Z',
  ].join('');
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
