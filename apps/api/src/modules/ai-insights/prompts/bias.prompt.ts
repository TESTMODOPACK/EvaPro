export function buildBiasPrompt(data: {
  cycleName: string;
  globalAvg: number;
  globalStdDev: number;
  evaluatorStats: Array<{
    evaluatorId: string;
    evaluatorName: string;
    scoreCount: number;
    avgScore: number;
    stdDev: number;
    minScore: number;
    maxScore: number;
    evaluatees: string[];
  }>;
  scoreDistribution: { range: string; count: number }[];
}): string {
  return `Eres un experto en psicometría y detección de sesgos en evaluaciones de desempeño laboral.

Analiza los siguientes datos estadísticos de un ciclo de evaluación y detecta posibles sesgos.

## Contexto del Ciclo
- Nombre: ${data.cycleName}
- Puntaje promedio global: ${data.globalAvg.toFixed(2)} (escala 0-10)
- Desviación estándar global: ${data.globalStdDev.toFixed(2)}

## Distribución de Puntajes del Ciclo
${JSON.stringify(data.scoreDistribution, null, 2)}

## Estadísticas por Evaluador
${data.evaluatorStats.map(e => `
### ${e.evaluatorName} (${e.scoreCount} evaluaciones)
- Promedio: ${e.avgScore.toFixed(2)} | Desv. Std: ${e.stdDev.toFixed(2)}
- Rango: ${e.minScore.toFixed(1)} - ${e.maxScore.toFixed(1)}
- Diferencia vs media global: ${(e.avgScore - data.globalAvg).toFixed(2)}
- Evaluados: ${e.evaluatees.join(', ')}
`).join('\n')}

## Tipos de Sesgo a Detectar
1. **Lenidad**: Evaluador que da puntajes consistentemente altos (media > media_global + 1.5σ)
2. **Severidad**: Evaluador que da puntajes consistentemente bajos (media < media_global - 1.5σ)
3. **Efecto Halo**: Evaluador que da puntajes muy uniformes a un evaluado (desv. estándar < 0.5)
4. **Tendencia Central**: Evaluador que evita extremos (todos los puntajes entre 4-6)
5. **Contraste**: Evaluador que compara evaluados entre sí en vez de contra el estándar

## Instrucciones
Genera un JSON con la siguiente estructura exacta (sin markdown, solo JSON puro):
{
  "biasesDetected": [
    {
      "type": "leniency|severity|halo|central_tendency|contrast",
      "severity": "high|medium|low",
      "evaluatorId": "uuid del evaluador",
      "evaluatorName": "nombre",
      "evidence": "Evidencia estadística específica",
      "affectedEvaluatees": ["nombres de evaluados afectados"],
      "recommendation": "Acción correctiva sugerida"
    }
  ],
  "overallAssessment": "Evaluación general de la calidad de las evaluaciones del ciclo (2-3 oraciones)",
  "recommendations": ["Recomendación general 1", "Recomendación 2"],
  "confidenceLevel": 0.85,
  "dataQuality": "Evaluación de si hay suficientes datos para un análisis confiable"
}

IMPORTANTE:
- Responde SOLO con JSON válido, sin texto adicional ni markdown
- Si no hay suficientes datos para detectar un sesgo con confianza, indícalo
- No reportes sesgos sin evidencia estadística clara
- confidenceLevel: 0.0 a 1.0 basado en cantidad y calidad de datos
- Usa español latinoamericano neutro`;
}
