export function buildSuggestionsPrompt(data: {
  employeeName: string;
  position: string;
  department: string;
  cycleName: string;
  overallScore: number | null;
  competencyRadar: any;
  selfVsOthers: any;
  nineBoxQuadrant: string | null;
  currentObjectives: Array<{ title: string; progress: number; status: string }>;
  competencies: Array<{ name: string; category: string }>;
  recentFeedback: Array<{ sentiment: string; message: string }>;
}): string {
  return `Eres un consultor experto en desarrollo profesional y planes de carrera para empresas latinoamericanas.

Genera sugerencias de desarrollo personalizadas basadas en los datos de evaluación del colaborador.

## Datos del Colaborador
- Nombre: ${data.employeeName}
- Cargo: ${data.position || 'No especificado'}
- Departamento: ${data.department || 'No especificado'}
- Ciclo: ${data.cycleName}
- Puntaje general: ${data.overallScore ?? 'N/A'}/10

## Cuadrante Nine Box
${data.nineBoxQuadrant || 'Sin evaluación de talento disponible'}

## Radar de Competencias
${JSON.stringify(data.competencyRadar?.sections || [], null, 2)}

## Brecha Autoevaluación vs Otros
- Autoevaluación: ${data.selfVsOthers?.selfScore ?? 'N/A'}
- Promedio otros: ${data.selfVsOthers?.othersAvg ?? 'N/A'}
- Brecha: ${data.selfVsOthers?.gap ?? 'N/A'}

## Objetivos Actuales
${data.currentObjectives.length > 0
    ? data.currentObjectives.map(o => `- ${o.title} (${o.progress}% avance, estado: ${o.status})`).join('\n')
    : 'Sin objetivos registrados'}

## Catálogo de Competencias Disponibles
${data.competencies.length > 0
    ? data.competencies.map(c => `- ${c.name} (${c.category})`).join('\n')
    : 'Sin catálogo de competencias'}

## Feedback Reciente
${data.recentFeedback.length > 0
    ? data.recentFeedback.map(f => `- [${f.sentiment}] "${f.message}"`).join('\n')
    : 'Sin feedback reciente'}

## Tipos de Acción de Desarrollo
Usa estos tipos: curso, mentoria, proyecto, taller, lectura, rotacion, certificacion, coaching

## Instrucciones
Genera un JSON con la siguiente estructura exacta (sin markdown, solo JSON puro):
{
  "suggestedActions": [
    {
      "title": "Título específico de la acción",
      "type": "curso|mentoria|proyecto|taller|lectura|rotacion|certificacion|coaching",
      "competencyName": "Nombre de competencia del catálogo (si aplica)",
      "priority": "alta|media|baja",
      "justification": "Por qué se recomienda esta acción basada en los datos (1-2 oraciones)",
      "estimatedDuration": "Duración estimada (ej: 2 semanas, 1 mes)"
    }
  ],
  "developmentFocus": "Área principal de desarrollo recomendada (1-2 oraciones)",
  "careerPath": "Sugerencia de trayectoria profesional basada en fortalezas y potencial (2-3 oraciones)",
  "quickWins": ["Acción inmediata 1 que puede hacer esta semana", "Acción 2"]
}

IMPORTANTE:
- Responde SOLO con JSON válido, sin texto adicional ni markdown
- Genera entre 3 y 6 acciones sugeridas, ordenadas por prioridad
- Vincula acciones a competencias del catálogo cuando sea posible
- Las acciones deben ser específicas y accionables, no genéricas
- Usa español latinoamericano neutro
- Si hay poca información, genera menos acciones pero de mayor calidad`;
}
