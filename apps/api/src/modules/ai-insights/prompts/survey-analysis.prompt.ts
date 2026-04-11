export function buildSurveyAnalysisPrompt(data: {
  surveyTitle: string;
  responseRate: number;
  totalResponses: number;
  overallAverage: number;
  averageByCategory: Array<{ category: string; average: number; count: number }>;
  averageByQuestion: Array<{ questionText: string; category: string; average: number }>;
  enps: { enps: number; promoters: number; passives: number; detractors: number; total: number } | null;
  departmentResults: Array<{ department: string; responseCount: number; average: number }>;
  openResponses: Array<{ questionText: string; category: string; text: string }>;
}): string {
  const categoryList = data.averageByCategory
    .map((c) => `- ${c.category}: ${c.average}/10 (${c.count} respuestas)`)
    .join('\n');

  const questionList = data.averageByQuestion
    .slice(0, 20)
    .map((q) => `- [${q.category}] "${q.questionText}": ${q.average}/10`)
    .join('\n');

  const deptList = data.departmentResults
    .map((d) => `- ${d.department}: ${d.average}/10 (${d.responseCount} respuestas)`)
    .join('\n');

  const enpsInfo = data.enps
    ? (() => {
        const total = data.enps.total || (data.enps.promoters + data.enps.passives + data.enps.detractors) || 0;
        const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
        return `eNPS: ${data.enps.enps} (Promotores: ${data.enps.promoters} / ${pct(data.enps.promoters)}%, Pasivos: ${data.enps.passives} / ${pct(data.enps.passives)}%, Detractores: ${data.enps.detractors} / ${pct(data.enps.detractors)}%, Total: ${total} respuestas)`;
      })()
    : 'No hay datos de eNPS disponibles.';

  const openTexts = data.openResponses
    .slice(0, 30)
    .map((o) => `- [${o.category}] "${o.text}"`)
    .join('\n');

  return `Eres un experto en recursos humanos y analisis organizacional. Analiza los resultados de la siguiente encuesta de clima organizacional y genera un informe ejecutivo completo en espanol.

ENCUESTA: "${data.surveyTitle}"
Tasa de respuesta: ${data.responseRate}%
Total respuestas: ${data.totalResponses}
Escala de puntuación: 1 a 10 (normalizada desde likert 1-5 multiplicada por 2)
Promedio general: ${data.overallAverage}/10

PROMEDIOS POR CATEGORIA:
${categoryList}

DETALLE POR PREGUNTA:
${questionList}

${enpsInfo}

RESULTADOS POR DEPARTAMENTO:
${deptList}

RESPUESTAS ABIERTAS (anonimizadas):
${openTexts || 'Sin respuestas abiertas.'}

Genera un JSON con la siguiente estructura exacta (sin texto adicional fuera del JSON):

{
  "executiveSummary": "Resumen ejecutivo de 3-5 oraciones describiendo el estado general del clima organizacional",
  "overallHealthScore": <numero 0-100 basado en el analisis general>,
  "enpsInterpretation": "Interpretacion del eNPS y su significado para la organizacion",
  "topStrengths": [
    { "category": "<categoria>", "score": <promedio>, "insight": "<interpretacion de por que es fortaleza>" }
  ],
  "criticalAreas": [
    { "category": "<categoria>", "score": <promedio>, "insight": "<interpretacion del problema>", "urgency": "high|medium|low" }
  ],
  "departmentHighlights": [
    { "department": "<nombre>", "finding": "<hallazgo relevante sobre este departamento>" }
  ],
  "sentimentAnalysis": {
    "positive": <porcentaje>,
    "neutral": <porcentaje>,
    "negative": <porcentaje>,
    "keyThemes": ["<tema1>", "<tema2>", "<tema3>"]
  },
  "recommendations": [
    { "title": "<titulo de la recomendacion>", "priority": "high|medium|low", "type": "initiative|training|policy|communication", "description": "<descripcion detallada de la recomendacion>" }
  ],
  "suggestedInitiatives": [
    {
      "title": "<titulo de la iniciativa de desarrollo organizacional>",
      "department": "<departamento objetivo o null si es transversal>",
      "description": "<descripcion de la iniciativa>",
      "actionItems": ["<accion concreta 1>", "<accion concreta 2>"]
    }
  ]
}

IMPORTANTE:
- TODOS los puntajes están en escala 1-10. Interpreta: ≥8 fortaleza, 6-8 aceptable, <6 área crítica.
- Incluye entre 2-4 fortalezas y 2-4 areas criticas
- Incluye entre 3-5 recomendaciones priorizadas
- Incluye entre 2-4 iniciativas sugeridas para desarrollo organizacional
- Las iniciativas deben ser concretas y accionables
- El health score debe reflejar: >80 excelente, 60-80 bueno, 40-60 necesita mejora, <40 critico
- Basa el analisis de sentimiento en las respuestas abiertas y los puntajes
- Todas las respuestas en espanol`;
}
