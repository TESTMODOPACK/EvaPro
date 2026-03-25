export function buildSummaryPrompt(data: {
  employeeName: string;
  position: string;
  department: string;
  cycleName: string;
  individualResults: any;
  competencyRadar: any;
  selfVsOthers: any;
  textResponses: string[];
}): string {
  return `Eres un consultor experto en gestión de talento y evaluación de desempeño para empresas latinoamericanas.

Analiza los siguientes datos de evaluación de desempeño y genera un resumen ejecutivo estructurado en español.

## Datos del Colaborador
- Nombre: ${data.employeeName}
- Cargo: ${data.position || 'No especificado'}
- Departamento: ${data.department || 'No especificado'}
- Ciclo de evaluación: ${data.cycleName}

## Resultados de Evaluación Individual
${JSON.stringify(data.individualResults?.evaluations || [], null, 2)}

## Radar de Competencias (puntajes por sección)
${JSON.stringify(data.competencyRadar?.sections || [], null, 2)}

## Comparativa Autoevaluación vs Otros
- Autoevaluación: ${data.selfVsOthers?.selfScore ?? 'N/A'}
- Promedio evaluadores: ${data.selfVsOthers?.othersAvg ?? 'N/A'}
- Brecha: ${data.selfVsOthers?.gap ?? 'N/A'}
- Interpretación: ${data.selfVsOthers?.interpretation || 'Sin datos suficientes'}
- Por tipo de relación: ${JSON.stringify(data.selfVsOthers?.byRelation || {})}

## Comentarios y Respuestas de Texto Libre
${data.textResponses.length > 0 ? data.textResponses.map((t, i) => `${i + 1}. "${t}"`).join('\n') : 'Sin respuestas de texto libre'}

## Instrucciones
Genera un JSON con la siguiente estructura exacta (sin markdown, solo JSON puro):
{
  "executiveSummary": "Resumen ejecutivo de 3-5 oraciones que sintetice el desempeño general",
  "strengths": ["Fortaleza 1 específica basada en datos", "Fortaleza 2"],
  "areasForImprovement": ["Área de mejora 1 específica", "Área 2"],
  "perceptionGap": "Análisis de la brecha entre autoevaluación y evaluación de otros (1-2 oraciones)",
  "trend": "Tendencia observada en el desempeño (si hay datos históricos) o análisis de consistencia",
  "recommendations": ["Recomendación accionable 1", "Recomendación 2", "Recomendación 3"]
}

IMPORTANTE:
- Responde SOLO con JSON válido, sin texto adicional ni markdown
- Usa español latinoamericano neutro
- Basa todas las conclusiones en los datos proporcionados, no inventes
- Las fortalezas y áreas de mejora deben ser específicas (no genéricas)
- Las recomendaciones deben ser accionables y concretas`;
}
