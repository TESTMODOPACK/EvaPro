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

## ESCALA DE PUNTUACIÓN (CRÍTICO)
**Todas las puntuaciones en este informe están normalizadas a escala 0-10**, donde:
- **10** = Excelente / Excede ampliamente las expectativas
- **8** = Muy Bueno / Supera expectativas
- **6** = Bueno / Cumple expectativas
- **4** = Regular / Necesita mejorar
- **2** = Deficiente / Por debajo de las expectativas

Cuando reportes valores en el resumen, usa SIEMPRE el formato "X.XX/10" (nunca "/5" ni otra escala).

## Datos del Colaborador
- Nombre: ${data.employeeName}
- Cargo: ${data.position || 'No especificado'}
- Departamento: ${data.department || 'No especificado'}
- Ciclo de evaluación: ${data.cycleName}

## Resultados de Evaluación Individual (overallScore en escala 0-10)
${JSON.stringify(data.individualResults?.evaluations || [], null, 2)}

## Radar de Competencias (puntajes por sección, escala 0-10)
${JSON.stringify(data.competencyRadar?.sections || [], null, 2)}

## Comparativa Autoevaluación vs Otros (escala 0-10)
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
- Las recomendaciones deben ser accionables y concretas
- **Cuando menciones puntuaciones, usa SIEMPRE el formato "X.XX/10"** (ej. "7.88/10", "4.42/10"). NUNCA uses "/5" porque las puntuaciones ya están normalizadas a escala 0-10`;
}
