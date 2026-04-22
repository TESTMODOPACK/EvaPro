/**
 * v3.1 F1 — Prompt para Agenda Mágica de 1:1.
 *
 * Input: contexto del employee (OKRs, feedback reciente, reconocimientos,
 * pendientes del check-in anterior).
 *
 * Output estructurado JSON: topics[] con priority high/med/low y rationale
 * que CITA la fuente concreta (ej: "OKR 'Mejorar NPS' con 20% avance y
 * target en 15 días"). Nunca inventar datos.
 *
 * Max tokens: 800 — respuesta corta, sin prosa, solo 4-6 topics accionables.
 */

export interface AgendaPromptInput {
  employeeName: string;
  employeePosition: string;
  employeeDepartment: string;

  // OKRs activos del empleado
  okrs: Array<{
    title: string;
    progress: number;
    status: string;
    daysToTarget: number | null;
  }>;

  // Feedback recibido en las últimas 4 semanas (sentiment + preview del mensaje)
  recentFeedback: Array<{
    sentiment: string;
    messagePreview: string;
    createdAt: string;
  }>;

  // Reconocimientos recibidos en las últimas 4 semanas
  recentRecognitions: Array<{
    valueName?: string;
    messagePreview: string;
    createdAt: string;
  }>;

  // Pendientes arrastrados del 1:1 anterior entre estos dos mismos usuarios
  pendingFromPrevious: Array<{
    text: string;
  }>;

  // Tema definido por el manager para el 1:1 (si existe)
  checkinTopic?: string;
}

export function buildAgendaPrompt(data: AgendaPromptInput): string {
  const okrsSummary = data.okrs.length > 0
    ? data.okrs
        .map((o) => {
          const timing = o.daysToTarget == null
            ? 'sin fecha objetivo'
            : o.daysToTarget < 0
              ? `VENCIDO hace ${Math.abs(o.daysToTarget)} días`
              : o.daysToTarget <= 14
                ? `target en ${o.daysToTarget} días`
                : `target en ${o.daysToTarget} días`;
          return `- "${o.title}" — ${o.progress}% completado, estado ${o.status}, ${timing}`;
        })
        .join('\n')
    : 'Sin OKRs activos.';

  const feedbackSummary = data.recentFeedback.length > 0
    ? data.recentFeedback
        .slice(0, 6)
        .map((f) => `- [${f.sentiment}] "${f.messagePreview.slice(0, 140)}"`)
        .join('\n')
    : 'Sin feedback reciente.';

  const recognitionsSummary = data.recentRecognitions.length > 0
    ? data.recentRecognitions
        .slice(0, 4)
        .map(
          (r) =>
            `- ${r.valueName ? `[valor: ${r.valueName}] ` : ''}"${r.messagePreview.slice(0, 100)}"`,
        )
        .join('\n')
    : 'Sin reconocimientos recientes.';

  const pendingSummary = data.pendingFromPrevious.length > 0
    ? data.pendingFromPrevious.map((p) => `- ${p.text}`).join('\n')
    : 'Sin pendientes del 1:1 anterior.';

  return `Eres un coach experto en liderazgo y gestión de personas. Tu rol es sugerir temas de conversación para una reunión 1:1 entre un manager y su colaborador directo, basándote en datos concretos del colaborador.

## Contexto del Colaborador
- Nombre: ${data.employeeName}
- Cargo: ${data.employeePosition || 'No especificado'}
- Departamento: ${data.employeeDepartment || 'No especificado'}

## OKRs activos
${okrsSummary}

## Feedback recibido últimas 4 semanas
${feedbackSummary}

## Reconocimientos últimas 4 semanas
${recognitionsSummary}

## Pendientes del 1:1 anterior
${pendingSummary}

${data.checkinTopic ? `## Tema definido por el manager para este 1:1\n"${data.checkinTopic}"\n` : ''}

## Instrucciones
Sugiere entre 3 y 5 temas de conversación específicos y accionables. Cada tema debe:
1. Estar basado en los datos provistos (nunca inventes información no incluida arriba).
2. Incluir un "rationale" que cite la fuente concreta del dato (ej: "El OKR 'X' está en 20% con target en 15 días").
3. Tener priority: "high" (urgente o bloqueante), "med" (importante pero no urgente), "low" (nice-to-have).
4. Ser accionable en una conversación de 30 minutos (no temas demasiado amplios).

Mezcla temas de celebrar (logros, reconocimientos) con temas de abordar (OKRs en riesgo, feedback constructivo, pendientes).

Genera un JSON con esta estructura exacta (sin markdown, solo JSON puro):
{
  "topics": [
    {
      "topic": "Descripción clara del tema, máx 80 caracteres",
      "rationale": "Justificación que cita la fuente específica de los datos, máx 200 caracteres",
      "priority": "high" | "med" | "low"
    }
  ]
}

IMPORTANTE:
- Responde SOLO con JSON válido, sin texto adicional ni markdown.
- Usa español latinoamericano neutro.
- Si NO hay datos suficientes para sugerir nada útil, retorna topics con un único tema genérico de chequeo general ("¿Cómo te sientes con tu carga actual?") y priority "low".
- NUNCA inventes datos (ej: no digas "tu OKR X tiene 30%" si el OKR no está en el contexto).
- Mantén las rationale cortas y específicas — evita generalidades.`;
}
