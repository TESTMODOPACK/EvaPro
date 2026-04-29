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
  /**
   * Si el caller filtro la lista de evaluadores (ej. top 30 por
   * desviacion), pasar el total original aqui para que Claude lo refleje
   * en `dataQuality` y `confidenceLevel`. `null` = no se filtro.
   */
  cappedFromTotal?: number | null;
}): string {
  const cappingNote = data.cappedFromTotal
    ? `\n> NOTA: Se analizan los ${data.evaluatorStats.length} evaluadores con MAYOR desviacion vs la media global (de ${data.cappedFromTotal} totales). El resto fueron evaluadores cercanos al promedio (sin sesgo evidente). Refleja este filtrado en \`dataQuality\`.\n`
    : '';

  return `Eres un experto en psicometría y detección de sesgos en evaluaciones de desempeño laboral.

Analiza los siguientes datos estadísticos de un ciclo de evaluación y detecta posibles sesgos.

## Contexto del Ciclo
- Nombre: ${data.cycleName}
- Puntaje promedio global: ${data.globalAvg.toFixed(2)} (escala 0-10)
- Desviación estándar global: ${data.globalStdDev.toFixed(2)}
${cappingNote}
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
      "evidence": "Evidencia estadística específica (1-2 oraciones, sin repetir todos los numeros)",
      "affectedEvaluatees": ["nombres de evaluados afectados (max 5)"],
      "recommendation": "Acción correctiva sugerida (1 oracion)"
    }
  ],
  "overallAssessment": "Evaluación general de la calidad de las evaluaciones del ciclo (2-3 oraciones)",
  "recommendations": ["Recomendación general 1", "Recomendación 2"],
  "confidenceLevel": 0.85,
  "dataQuality": "Evaluación de si hay suficientes datos para un análisis confiable"
}

IMPORTANTE:
- Responde SOLO con JSON válido, sin texto adicional ni markdown
- **Reporta MÁXIMO 15 sesgos** (los más severos/relevantes). Si detectas más, agrega los de menor severidad como linea unica en \`overallAssessment\`.
- En \`evidence\` no repitas todos los numeros — describe el patron en 1-2 oraciones cortas.
- En \`affectedEvaluatees\` lista MÁXIMO 5 nombres por sesgo (los mas afectados).
- Si no hay suficientes datos para detectar un sesgo con confianza, indícalo
- No reportes sesgos sin evidencia estadística clara
- confidenceLevel: 0.0 a 1.0 basado en cantidad y calidad de datos
- Usa español latinoamericano neutro`;
}
