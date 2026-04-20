/**
 * push-messages.ts — mensajes i18n para notificaciones push (3 idiomas).
 *
 * Centralizado acá para que todos los services que disparen push usen
 * los mismos títulos/cuerpos sin duplicar strings. Mantenemos solo los
 * 6 eventos priorizados en v3.0-P0. Cada evento tiene un `title` fijo
 * y un `body` con placeholders tipo `{{name}}` que se interpolan.
 *
 * Extensible: agregar un nuevo evento requiere agregar 3 traducciones
 * y exportar el builder.
 */

export type PushLocale = 'es' | 'en' | 'pt';

interface PushMessage {
  title: Record<PushLocale, string>;
  body: Record<PushLocale, string>;
}

const MESSAGES = {
  evaluationAssigned: {
    title: {
      es: 'Nueva evaluación asignada',
      en: 'New evaluation assigned',
      pt: 'Nova avaliação atribuída',
    },
    body: {
      es: 'Evaluación de {{evaluatee}} — vence {{date}}',
      en: 'Evaluation of {{evaluatee}} — due {{date}}',
      pt: 'Avaliação de {{evaluatee}} — vence {{date}}',
    },
  },
  /** v3.0: variante cuando se lanza ciclo con N pending evaluations.
      Placeholder {{count}} se interpola con el número; los textos en cada
      idioma tienen la palabra "colaborador(es)" localizada. */
  evaluationAssignedBulk: {
    title: {
      es: 'Nuevas evaluaciones asignadas',
      en: 'New evaluations assigned',
      pt: 'Novas avaliações atribuídas',
    },
    body: {
      es: 'Tienes {{count}} evaluaciones — vencen {{date}}',
      en: 'You have {{count}} evaluations — due {{date}}',
      pt: 'Você tem {{count}} avaliações — vencem {{date}}',
    },
  },
  checkinScheduled: {
    title: {
      es: 'Check-in 1:1 agendado',
      en: '1:1 check-in scheduled',
      pt: 'Check-in 1:1 agendado',
    },
    body: {
      es: 'Con {{other}} el {{date}}{{time}}',
      en: 'With {{other}} on {{date}}{{time}}',
      pt: 'Com {{other}} em {{date}}{{time}}',
    },
  },
  objectivePendingApproval: {
    title: {
      es: 'Objetivo por aprobar',
      en: 'Objective pending approval',
      pt: 'Objetivo para aprovar',
    },
    body: {
      es: '{{employee}} propone: {{title}}',
      en: '{{employee}} proposes: {{title}}',
      pt: '{{employee}} propõe: {{title}}',
    },
  },
  feedbackReceived: {
    title: {
      es: 'Nuevo feedback recibido',
      en: 'New feedback received',
      pt: 'Novo feedback recebido',
    },
    body: {
      es: '{{from}} te envió un feedback',
      en: '{{from}} sent you feedback',
      pt: '{{from}} enviou um feedback',
    },
  },
  recognitionReceived: {
    title: {
      es: '¡Reconocimiento recibido!',
      en: 'Recognition received!',
      pt: 'Reconhecimento recebido!',
    },
    body: {
      es: '{{from}} te reconoció: {{message}}',
      en: '{{from}} recognized you: {{message}}',
      pt: '{{from}} te reconheceu: {{message}}',
    },
  },
  surveyActive: {
    title: {
      es: 'Nueva encuesta de clima',
      en: 'New climate survey',
      pt: 'Nova pesquisa de clima',
    },
    body: {
      es: '{{title}} — tarda 2 minutos',
      en: '{{title}} — takes 2 minutes',
      pt: '{{title}} — leva 2 minutos',
    },
  },
} satisfies Record<string, PushMessage>;

export type PushMessageKey = keyof typeof MESSAGES;

/**
 * Resuelve un mensaje de push en el idioma del user (default 'es').
 * Interpola placeholders {{name}} con los valores del object `data`.
 * Valores faltantes se dejan como el placeholder literal para debug.
 */
export function buildPushMessage(
  key: PushMessageKey,
  locale: string | null | undefined,
  data: Record<string, string | number | null | undefined> = {},
): { title: string; body: string } {
  const lang = normalizeLocale(locale);
  const msg = MESSAGES[key];
  return {
    title: interpolate(msg.title[lang], data),
    body: interpolate(msg.body[lang], data),
  };
}

function normalizeLocale(locale: string | null | undefined): PushLocale {
  if (!locale) return 'es';
  const prefix = locale.toLowerCase().slice(0, 2);
  if (prefix === 'en' || prefix === 'pt') return prefix;
  return 'es';
}

function interpolate(
  template: string,
  data: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = data[k];
    return v == null ? `{{${k}}}` : String(v);
  });
}
