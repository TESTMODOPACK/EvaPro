import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EngagementSurvey } from '../surveys/entities/engagement-survey.entity';
import { SurveyResponse } from '../surveys/entities/survey-response.entity';
import { SurveyQuestion } from '../surveys/entities/survey-question.entity';
import { User } from '../users/entities/user.entity';

export interface DepartmentCross {
  department: string;
  performance: number | null;
  engagement: number | null;
  eNPS: number | null;
  quadrant: 'star' | 'burnout_risk' | 'opportunity' | 'critical' | 'no_data';
  performanceCount: number;
  engagementCount: number;
}

const PERF_THRESHOLD = 7.0;  // 0-10 scale
const ENG_THRESHOLD = 3.5;   // 1-5 scale

function classifyQuadrant(perf: number | null, eng: number | null): DepartmentCross['quadrant'] {
  if (perf == null || eng == null) return 'no_data';
  if (perf >= PERF_THRESHOLD && eng >= ENG_THRESHOLD) return 'star';
  if (perf >= PERF_THRESHOLD && eng < ENG_THRESHOLD) return 'burnout_risk';
  if (perf < PERF_THRESHOLD && eng >= ENG_THRESHOLD) return 'opportunity';
  return 'critical';
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : Number((num / den).toFixed(3));
}

const QUADRANT_LABELS: Record<string, { label: string; color: string; action: string }> = {
  star: { label: 'Estrella', color: '#10b981', action: 'Mantener y replicar buenas prácticas en otras áreas' },
  burnout_risk: { label: 'Riesgo de Burnout', color: '#f59e0b', action: 'Intervenir clima urgente — alto riesgo de rotación pese a buen desempeño' },
  opportunity: { label: 'Oportunidad', color: '#6366f1', action: 'Invertir en capacitación técnica y gestión — el equipo está motivado' },
  critical: { label: 'Crítico', color: '#ef4444', action: 'Plan de acción integral urgente — bajo desempeño y bajo compromiso' },
  no_data: { label: 'Sin datos', color: '#94a3b8', action: 'No hay datos suficientes para clasificar' },
};

@Injectable()
export class CrossAnalysisService {
  private readonly logger = new Logger(CrossAnalysisService.name);

  constructor(
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse)
    private readonly evalResponseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EngagementSurvey)
    private readonly surveyRepo: Repository<EngagementSurvey>,
    @InjectRepository(SurveyResponse)
    private readonly responseRepo: Repository<SurveyResponse>,
    @InjectRepository(SurveyQuestion)
    private readonly questionRepo: Repository<SurveyQuestion>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** List available cycles and surveys for selection */
  async getAvailableData(tenantId: string) {
    const cycles = await this.cycleRepo.find({
      where: { tenantId, status: CycleStatus.CLOSED },
      select: ['id', 'name', 'type', 'startDate', 'endDate'],
      order: { endDate: 'DESC' },
    });
    const surveys = await this.surveyRepo.find({
      where: { tenantId, status: 'closed' },
      select: ['id', 'title', 'startDate', 'endDate'],
      order: { endDate: 'DESC' },
    });
    return { cycles, surveys };
  }

  async getCrossAnalysis(tenantId: string, cycleIds?: string[], surveyId?: string, managerId?: string) {
    // 1. Get performance data from cycles (multiple supported)
    let cycles: any[] = [];
    if (cycleIds?.length) {
      for (const cid of cycleIds) {
        const c = await this.cycleRepo.findOne({ where: { id: cid, tenantId } });
        if (c) cycles.push(c);
      }
    } else {
      const latest = await this.cycleRepo.findOne({ where: { tenantId, status: CycleStatus.CLOSED }, order: { endDate: 'DESC' } });
      if (latest) cycles = [latest];
    }

    // 2. Get survey data
    const survey = surveyId
      ? await this.surveyRepo.findOne({ where: { id: surveyId, tenantId }, relations: ['questions'] })
      : await this.surveyRepo.findOne({ where: { tenantId, status: 'closed' }, order: { endDate: 'DESC' }, relations: ['questions'] });

    if (cycles.length === 0 && !survey) {
      return { error: 'No hay ciclos de evaluación ni encuestas cerradas disponibles para el análisis.' };
    }

    // 3. Validate: cycles and survey must be within 1 year of each other
    if (survey && cycles.length > 0) {
      const surveyEnd = new Date(survey.endDate || survey.startDate);
      for (const c of cycles) {
        const cycleEnd = new Date(c.endDate || c.startDate);
        const diffMs = Math.abs(surveyEnd.getTime() - cycleEnd.getTime());
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > 365) {
          return { error: `El ciclo "${c.name}" y la encuesta "${survey.title}" tienen más de 1 año de diferencia. Seleccione datos del mismo período.` };
        }
      }
    }

    // 3. Get users for scope
    const userWhere: any = { tenantId, isActive: true };
    if (managerId) userWhere.managerId = managerId;
    const users = await this.userRepo.find({ where: userWhere, select: ['id', 'department'] });
    const userIds = new Set(users.map(u => u.id));

    // 4. Performance by department — aggregate from all selected cycles
    const perfByDept: Record<string, number[]> = {};
    for (const cycle of cycles) {
      const assignments = await this.assignmentRepo.find({
        where: { cycleId: cycle.id, tenantId },
        relations: ['evaluatee'],
      });
      const assignmentIds = assignments.map(a => a.id);
      const responses = assignmentIds.length > 0
        ? await this.evalResponseRepo.find({ where: { assignmentId: In(assignmentIds) }, select: ['assignmentId', 'overallScore'] })
        : [];
      const scoreByAssignment = new Map(responses.filter(r => r.overallScore != null).map(r => [r.assignmentId, Number(r.overallScore)]));

      for (const a of assignments) {
        if (managerId && !userIds.has(a.evaluateeId)) continue;
        const score = scoreByAssignment.get(a.id);
        if (score == null) continue;
        const dept = (a.evaluatee as any)?.department || 'Sin departamento';
        if (!perfByDept[dept]) perfByDept[dept] = [];
        perfByDept[dept].push(score);
      }
    }

    // 5. Engagement by department
    const engByDept: Record<string, number[]> = {};
    const engByCat: Record<string, number[]> = {};
    let eNPSScores: number[] = [];

    if (survey) {
      const responses = await this.responseRepo.find({
        where: { surveyId: survey.id, isComplete: true },
      });
      const questions = survey.questions || await this.questionRepo.find({ where: { surveyId: survey.id } });
      const npsQuestionIds = new Set(questions.filter(q => q.questionType === 'nps').map(q => q.id));
      const likertQuestionIds = new Map(questions.filter(q => q.questionType === 'likert_5').map(q => [q.id, q.category]));

      for (const resp of responses) {
        if (managerId && resp.respondentId && !userIds.has(resp.respondentId)) continue;
        const dept = resp.department || 'Sin departamento';
        const answers: Array<{ questionId: string; value: any }> = resp.answers || [];
        const likertValues: number[] = [];

        for (const ans of answers) {
          if (npsQuestionIds.has(ans.questionId) && typeof ans.value === 'number') {
            eNPSScores.push(ans.value);
          }
          if (likertQuestionIds.has(ans.questionId) && typeof ans.value === 'number') {
            likertValues.push(ans.value);
            const cat = likertQuestionIds.get(ans.questionId)!;
            if (!engByCat[cat]) engByCat[cat] = [];
            engByCat[cat].push(ans.value);
          }
        }

        if (likertValues.length > 0) {
          const avg = likertValues.reduce((s, v) => s + v, 0) / likertValues.length;
          if (!engByDept[dept]) engByDept[dept] = [];
          engByDept[dept].push(avg);
        }
      }
    }

    // 6. Cross departments
    const allDepts = new Set([...Object.keys(perfByDept), ...Object.keys(engByDept)]);
    const departments: DepartmentCross[] = [];

    for (const dept of allDepts) {
      const perfScores = perfByDept[dept] || [];
      const engScores = engByDept[dept] || [];
      const avgPerf = perfScores.length > 0 ? Number((perfScores.reduce((s, v) => s + v, 0) / perfScores.length).toFixed(2)) : null;
      const avgEng = engScores.length > 0 ? Number((engScores.reduce((s, v) => s + v, 0) / engScores.length).toFixed(2)) : null;

      departments.push({
        department: dept,
        performance: avgPerf,
        engagement: avgEng,
        eNPS: null, // per-dept eNPS not available (anonymous)
        quadrant: classifyQuadrant(avgPerf, avgEng),
        performanceCount: perfScores.length,
        engagementCount: engScores.length,
      });
    }

    departments.sort((a, b) => a.department.localeCompare(b.department));

    // 7. Compute org-level summary
    const allPerf = Object.values(perfByDept).flat();
    const allEng = Object.values(engByDept).flat();
    const avgPerformance = allPerf.length > 0 ? Number((allPerf.reduce((s, v) => s + v, 0) / allPerf.length).toFixed(2)) : null;
    const avgEngagement = allEng.length > 0 ? Number((allEng.reduce((s, v) => s + v, 0) / allEng.length).toFixed(2)) : null;

    // eNPS calculation
    let eNPS: number | null = null;
    if (eNPSScores.length > 0) {
      const promoters = eNPSScores.filter(s => s >= 9).length;
      const detractors = eNPSScores.filter(s => s <= 6).length;
      eNPS = Math.round(((promoters - detractors) / eNPSScores.length) * 100);
    }

    // 8. Correlation: performance vs engagement at department level
    const deptPerfArr: number[] = [];
    const deptEngArr: number[] = [];
    for (const d of departments) {
      if (d.performance != null && d.engagement != null) {
        deptPerfArr.push(d.performance);
        deptEngArr.push(d.engagement);
      }
    }
    const correlation = pearsonCorrelation(deptPerfArr, deptEngArr);

    // 9. Category correlation (which climate dimension most correlates with performance)
    const categoryCorrelation: { category: string; avgScore: number; correlation: number; interpretation: string }[] = [];
    // Build per-department category averages and correlate with performance
    for (const [cat, scores] of Object.entries(engByCat)) {
      const catAvg = Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2));
      // Simplified: use overall avg as proxy (full per-dept correlation would need per-dept per-cat breakdown)
      categoryCorrelation.push({
        category: cat,
        avgScore: catAvg,
        correlation: 0, // simplified
        interpretation: catAvg >= 4.0 ? 'Fortaleza' : catAvg >= 3.0 ? 'Aceptable' : 'Área de mejora',
      });
    }
    categoryCorrelation.sort((a, b) => b.avgScore - a.avgScore);

    // 10. Generate insights
    const insights: string[] = [];
    const quadrants = {
      star: departments.filter(d => d.quadrant === 'star'),
      burnout_risk: departments.filter(d => d.quadrant === 'burnout_risk'),
      opportunity: departments.filter(d => d.quadrant === 'opportunity'),
      critical: departments.filter(d => d.quadrant === 'critical'),
    };

    if (quadrants.critical.length > 0) {
      insights.push(`${quadrants.critical.length} departamento(s) en situación crítica (bajo desempeño + bajo clima): ${quadrants.critical.map(d => d.department).join(', ')}. Requieren intervención integral urgente.`);
    }
    if (quadrants.burnout_risk.length > 0) {
      insights.push(`${quadrants.burnout_risk.length} departamento(s) con riesgo de burnout (alto desempeño pero bajo clima): ${quadrants.burnout_risk.map(d => d.department).join(', ')}. Priorizar bienestar para evitar fuga de talento.`);
    }
    if (quadrants.opportunity.length > 0) {
      insights.push(`${quadrants.opportunity.length} departamento(s) con oportunidad de crecimiento (buen clima pero bajo desempeño): ${quadrants.opportunity.map(d => d.department).join(', ')}. Invertir en capacitación técnica.`);
    }
    if (quadrants.star.length > 0) {
      insights.push(`${quadrants.star.length} departamento(s) estrella: ${quadrants.star.map(d => d.department).join(', ')}. Documentar y replicar sus prácticas.`);
    }
    if (correlation >= 0.5) {
      insights.push(`Correlación positiva fuerte (${correlation}) entre clima y desempeño. Mejorar el clima laboral tiene alto impacto en la productividad.`);
    } else if (correlation >= 0.2) {
      insights.push(`Correlación positiva moderada (${correlation}) entre clima y desempeño. Las mejoras de clima tienden a mejorar los resultados.`);
    } else if (correlation <= -0.2) {
      insights.push(`Correlación negativa (${correlation}). Posibles factores de presión: áreas con alto desempeño podrían estar sacrificando bienestar.`);
    }

    const lowCat = categoryCorrelation.filter(c => c.avgScore < 3.0);
    if (lowCat.length > 0) {
      insights.push(`Dimensiones de clima con menor puntaje: ${lowCat.map(c => `${c.category} (${c.avgScore})`).join(', ')}. Priorizar estas áreas en el plan de acción.`);
    }

    return {
      summary: {
        avgPerformance,
        avgEngagement,
        eNPS,
        correlation,
        totalDepartments: departments.length,
        performanceScale: '0-10',
        engagementScale: '1-5',
        thresholds: { performance: PERF_THRESHOLD, engagement: ENG_THRESHOLD },
      },
      departments,
      quadrants,
      quadrantLabels: QUADRANT_LABELS,
      categoryCorrelation,
      insights,
      cycleName: cycles.map(c => c.name).join(' + ') || null,
      cycleCount: cycles.length,
      surveyTitle: survey?.title || null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Export CSV ────────────────────────────────────────────────────────

  exportCsv(data: any): string {
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const lines: string[] = [];

    lines.push('Análisis Integrado Clima–Desempeño');
    lines.push(`Ciclo,${esc(data.cycleName || 'N/A')}`);
    lines.push(`Encuesta,${esc(data.surveyTitle || 'N/A')}`);
    lines.push(`Promedio Desempeño,${data.summary?.avgPerformance ?? 'N/A'}`);
    lines.push(`Promedio Clima,${data.summary?.avgEngagement ?? 'N/A'}`);
    lines.push(`eNPS,${data.summary?.eNPS ?? 'N/A'}`);
    lines.push(`Correlación,${data.summary?.correlation ?? 'N/A'}`);
    lines.push('');

    lines.push('Departamentos');
    lines.push('Departamento,Desempeño,Clima,Cuadrante,Eval. Desempeño,Resp. Clima');
    for (const d of data.departments || []) {
      const ql = QUADRANT_LABELS[d.quadrant]?.label || d.quadrant;
      lines.push(`${esc(d.department)},${d.performance ?? ''},${d.engagement ?? ''},${esc(ql)},${d.performanceCount},${d.engagementCount}`);
    }
    lines.push('');

    if (data.categoryCorrelation?.length) {
      lines.push('Dimensiones de Clima');
      lines.push('Categoría,Promedio,Interpretación');
      for (const c of data.categoryCorrelation) {
        lines.push(`${esc(c.category)},${c.avgScore},${esc(c.interpretation)}`);
      }
      lines.push('');
    }

    if (data.insights?.length) {
      lines.push('Insights');
      for (const i of data.insights) lines.push(esc(i));
    }

    return '\uFEFF' + lines.join('\n');
  }

  // ─── Export XLSX ───────────────────────────────────────────────────────

  async exportXlsx(data: any): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Análisis Integrado Clima–Desempeño']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Ciclo de Evaluación', data.cycleName || 'N/A']);
    ws1.addRow(['Encuesta de Clima', data.surveyTitle || 'N/A']);
    ws1.addRow(['Promedio Desempeño (0-10)', data.summary?.avgPerformance ?? 'N/A']);
    ws1.addRow(['Promedio Clima (1-5)', data.summary?.avgEngagement ?? 'N/A']);
    ws1.addRow(['eNPS', data.summary?.eNPS ?? 'N/A']);
    ws1.addRow(['Correlación Pearson', data.summary?.correlation ?? 'N/A']);

    // Sheet 2: Departamentos
    const ws2 = wb.addWorksheet('Departamentos');
    ws2.columns = [
      { header: 'Departamento', width: 25 }, { header: 'Desempeño', width: 12 },
      { header: 'Clima', width: 10 }, { header: 'Cuadrante', width: 20 },
      { header: 'Eval.', width: 8 }, { header: 'Resp.', width: 8 },
    ];
    for (const d of data.departments || []) {
      ws2.addRow([d.department, d.performance, d.engagement, QUADRANT_LABELS[d.quadrant]?.label || d.quadrant, d.performanceCount, d.engagementCount]);
    }

    // Sheet 3: Dimensiones de Clima
    if (data.categoryCorrelation?.length) {
      const ws3 = wb.addWorksheet('Dimensiones Clima');
      ws3.columns = [{ header: 'Categoría', width: 20 }, { header: 'Promedio', width: 10 }, { header: 'Interpretación', width: 18 }];
      for (const c of data.categoryCorrelation) ws3.addRow([c.category, c.avgScore, c.interpretation]);
    }

    // Sheet 4: Insights
    if (data.insights?.length) {
      const ws4 = wb.addWorksheet('Insights');
      ws4.columns = [{ header: 'Insight', width: 100 }];
      for (const i of data.insights) ws4.addRow([i]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Export PDF ────────────────────────────────────────────────────────

  async exportPdf(data: any): Promise<Buffer> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    let y = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Analisis Integrado Clima - Desempeno', 105, y, { align: 'center' });
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Ciclo: ${data.cycleName || 'N/A'}  |  Encuesta: ${data.surveyTitle || 'N/A'}  |  ${new Date().toLocaleDateString('es-CL')}`, 105, y, { align: 'center' });
    y += 12;
    doc.setTextColor(0);

    // KPIs
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Indicadores Clave', 20, y); y += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Promedio Desempeno: ${data.summary?.avgPerformance ?? 'N/A'} / 10`, 20, y); y += 5;
    doc.text(`Promedio Clima: ${data.summary?.avgEngagement ?? 'N/A'} / 5`, 20, y); y += 5;
    doc.text(`eNPS: ${data.summary?.eNPS ?? 'N/A'}`, 20, y); y += 5;
    doc.text(`Correlacion: ${data.summary?.correlation ?? 'N/A'}`, 20, y); y += 10;

    // Quadrants
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Clasificacion por Cuadrante', 20, y); y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    for (const [key, q] of Object.entries(QUADRANT_LABELS)) {
      if (key === 'no_data') continue;
      const count = (data.quadrants?.[key] || []).length;
      doc.text(`${q.label} (${count} depto.): ${q.action}`, 22, y); y += 5;
    }
    y += 5;

    // Departments
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Departamentos', 20, y); y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    for (const d of (data.departments || []).slice(0, 20)) {
      if (y > 250) { doc.addPage(); y = 20; }
      const ql = QUADRANT_LABELS[d.quadrant]?.label || '?';
      doc.text(`${d.department}: Desempeno ${d.performance ?? '-'} | Clima ${d.engagement ?? '-'} | ${ql}`, 22, y); y += 5;
    }
    y += 5;

    // Insights
    if (data.insights?.length) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Analisis e Insights', 20, y); y += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      for (const ins of data.insights) {
        if (y > 250) { doc.addPage(); y = 20; }
        const lines = doc.splitTextToSize(`- ${ins}`, 170);
        doc.text(lines, 22, y); y += lines.length * 4 + 3;
      }
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
