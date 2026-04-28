/**
 * Centralised API client for EvaPro.
 */
const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://evaluacion-desempeno-api.onrender.com";

if (typeof window !== "undefined") {
  console.info("[EvaPro] API base URL:", BASE_URL);
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthTokens { access_token: string }
export interface UserProfile { userId: string; email: string; tenantId: string; role: string }

export interface Tenant {
  id: string; name: string; slug: string; rut: string | null; plan: string;
  ownerType: string; maxEmployees: number; isActive: boolean; createdAt: string;
  industry?: string | null; employeeRange?: string | null; commercialAddress?: string | null;
  legalRepName?: string | null; legalRepRut?: string | null;
  settings?: Record<string, any>;
}

export interface UserData {
  id: string; tenantId: string; email: string; firstName: string; lastName: string;
  role: string; managerId: string | null; department: string | null;
  departmentId?: string | null; position: string | null; positionId?: string | null;
  hireDate: string | null; isActive: boolean; createdAt: string;
  departureDate?: string | null;
  // Demographic (optional)
  gender?: string | null; birthDate?: string | null; nationality?: string | null;
  seniorityLevel?: string | null; contractType?: string | null; workLocation?: string | null;
  // CV
  cvUrl?: string | null; cvFileName?: string | null;
}

export interface DepartmentData {
  id: string; tenantId: string; name: string; isActive: boolean; sortOrder: number;
  createdAt: string; updatedAt: string;
}

export interface PositionData {
  id: string; tenantId: string; name: string; level: number; isActive: boolean;
  createdAt: string; updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[]; total: number; page: number; limit: number;
}

/** Parámetros opcionales para listas paginadas + searchables del módulo
 *  de evaluaciones (bandeja del usuario). El backend trata `undefined`
 *  como "no aplicar ese filtro". */
export interface EvalListParams {
  search?: string;
  cycleId?: string;
  /** Filtra por relationType (manager|peer|self|direct_report|external) */
  relationType?: string;
  /** Campo de ordenamiento. 'date' es el default. 'score' solo en
   *  endpoints que tienen response (completed, received, team-received). */
  sortBy?: 'date' | 'score';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** Stats agregados de evaluaciones del usuario. Usado para los KPI cards
 *  de la bandeja — cuentas REALES, no page-local. */
export interface EvalStatsResponse {
  pending: { count: number; distinctCycles: number; byCycle: { id: string; name: string; count: number }[] };
  completed: { count: number; distinctCycles: number; byCycle: { id: string; name: string; count: number }[] };
  total: { count: number; distinctCycles: number; byCycle: { id: string; name: string; count: number }[] };
}

/** Construye `?key=value&...` ignorando entries undefined/null/'' */
function buildEvalQuery(opts: EvalListParams): string {
  const p = new URLSearchParams();
  if (opts.search) p.set('search', opts.search);
  if (opts.cycleId) p.set('cycleId', opts.cycleId);
  if (opts.relationType) p.set('relationType', opts.relationType);
  if (opts.sortBy) p.set('sortBy', opts.sortBy);
  if (opts.sortDir) p.set('sortDir', opts.sortDir);
  if (opts.page !== undefined) p.set('page', String(opts.page));
  if (opts.limit !== undefined) p.set('limit', String(opts.limit));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export interface CycleData {
  id: string; tenantId: string; name: string; type: string; status: string;
  period: string;
  startDate: string; endDate: string; description: string | null;
  templateId: string | null; createdBy: string | null;
  settings: any; totalEvaluated: number; createdAt: string; updatedAt: string;
}

export interface AssignmentData {
  id: string; tenantId: string; cycleId: string;
  evaluateeId: string; evaluatorId: string; relationType: string;
  status: string; dueDate: string | null; completedAt: string | null;
  createdAt: string;
  evaluatee?: UserData; evaluator?: UserData; cycle?: CycleData;
}

export interface ResponseData {
  id: string; tenantId: string; assignmentId: string;
  answers: any; overallScore: number | null;
  submittedAt: string | null; createdAt: string;
}

export interface TemplateData {
  id: string; tenantId: string | null; name: string;
  description: string | null; sections: any[];
  isDefault: boolean; createdBy: string | null; createdAt: string;
}

export interface DashboardStats {
  totalCycles: number; activeCycles: number;
  totalAssignments: number; completedAssignments: number;
  pendingAssignments: number; completionRate: number;
  /** Personas únicas con al menos una evaluación completada (DISTINCT
   *  evaluatee). Distinto a completedAssignments — Pedro con 6 evals
   *  cuenta 1 aquí, pero 6 en completedAssignments. */
  evaluatedPeopleCount: number;
  /** Personas que tienen TODAS sus evals completadas (>=1 completed,
   *  0 pending). Subset de evaluatedPeopleCount. */
  fullyEvaluatedCount: number;
  /** Assignments pendientes con due_date < hoy. */
  overdueCount: number;
  /** Assignments pendientes con due_date entre hoy y +7 días. */
  dueSoonCount: number;
  /** Diferencia de avg score entre el último ciclo cerrado y el
   *  anterior (recientAvg - prevAvg). null si no hay 2 ciclos
   *  cerrados con data en el scope. */
  cycleScoreDelta: number | null;
  averageScore: string | null;
  scope?: 'team' | 'organization' | 'personal';
  teamSize?: number | null;
}

export interface UserNoteData {
  id: string; tenantId: string; userId: string; authorId: string;
  category: string; title: string; content: string;
  isConfidential: boolean; createdAt: string; updatedAt: string;
  author?: UserData;
}

export interface BulkImportData {
  id: string; tenantId: string; type: string; status: string;
  totalRows: number; successRows: number; errorRows: number;
  errors: { row: number; message: string }[] | null; createdAt: string;
}

export interface CycleSummary {
  cycle: CycleData;
  totalAssignments: number; completedAssignments: number;
  completionRate: number; averageScore: string | null;
  departmentBreakdown: { department: string; avgScore: string; count: number }[];
}

export interface PeerAssignmentData {
  id: string; tenantId: string; cycleId: string;
  evaluateeId: string; evaluatorId: string;
  evaluatee?: UserData; evaluator?: UserData; createdAt: string;
}

export interface CheckInData {
  id: string; tenantId: string; managerId: string; employeeId: string;
  scheduledDate: string;
  scheduledTime?: string | null;
  locationId?: string | null;
  location?: { id: string; name: string; type: string } | null;
  topic: string; notes: string | null;
  minutes?: string | null;
  rating?: number | null;
  actionItems: { text: string; completed: boolean; assigneeId?: string; assigneeName?: string; dueDate?: string }[];
  agendaTopics?: { text: string; addedBy: string; addedByName?: string; addedAt?: string }[];
  status: 'requested' | 'scheduled' | 'completed' | 'cancelled' | 'rejected';
  rejectionReason?: string | null;
  rejectedBy?: string | null;
  emailSent?: boolean;
  /** v3.1 — true si fue auto-cerrado por el cron +5d. UI muestra badge. */
  autoCompleted?: boolean;
  completedAt: string | null; createdAt: string;
  manager?: UserData; employee?: UserData;
}

// v3.1 Tema B — Reunión de equipo (N participantes).
export interface TeamMeetingParticipantData {
  id: string;
  meetingId: string;
  userId: string;
  status: 'invited' | 'accepted' | 'declined' | 'attended';
  declineReason?: string | null;
  invitedAt: string;
  respondedAt?: string | null;
  user?: UserData;
}

export interface TeamMeetingData {
  id: string;
  tenantId: string;
  organizerId: string;
  title: string;
  description: string | null;
  scheduledDate: string;
  scheduledTime?: string | null;
  locationId?: string | null;
  location?: { id: string; name: string; type: string } | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  agendaTopics?: Array<{ text: string; addedBy: string; addedByName?: string; addedAt?: string }>;
  actionItems?: Array<{ text: string; completed: boolean; assigneeName?: string; dueDate?: string }>;
  notes?: string | null;
  minutes?: string | null;
  rating?: number | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  emailSent?: boolean;
  /** v3.1 — true si fue auto-cerrada por el cron +5d. UI muestra badge. */
  autoCompleted?: boolean;
  participants?: TeamMeetingParticipantData[];
  organizer?: UserData;
  createdAt: string;
  updatedAt: string;
}

// v3.1 F6 — Leader streaks (hábitos del líder)
export interface LeaderStreaksData {
  userId: string;
  firstName?: string;
  lastName?: string;
  department?: string | null;
  position?: string | null;
  checkinsWeekly: { current: number; best: number; period: 'weekly' | 'monthly' };
  recognitionsMonthly: { current: number; best: number; period: 'weekly' | 'monthly' };
  feedbackWeekly: { current: number; best: number; period: 'weekly' | 'monthly' };
  totalScore: number;
}

// v3.1 F3 — Mood check-in diario
export interface MoodCheckinData {
  id: string;
  tenantId: string;
  userId: string;
  checkinDate: string;
  score: number; // 1-5
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuickFeedbackData {
  id: string; tenantId: string; fromUserId: string; toUserId: string;
  message: string; sentiment: 'positive' | 'neutral' | 'constructive';
  category: string | null; isAnonymous: boolean; createdAt: string;
  fromUser?: UserData; toUser?: UserData;
}

export interface ObjectiveData {
  id: string; tenantId: string; userId: string;
  title: string; description: string | null;
  type: 'OKR' | 'KPI' | 'SMART'; progress: number;
  weight: number;
  parentObjectiveId: string | null;
  targetDate: string | null; status: string;
  cycleId: string | null; createdAt: string; updatedAt: string;
}

export interface ObjectiveUpdateData {
  id: string; objectiveId: string; progressValue: number;
  notes: string | null; createdBy: string; createdAt: string;
}

export interface PerformanceHistoryEntry {
  cycleId: string; cycleName: string; cycleType?: string; period?: string;
  startDate: string; endDate: string;
  avgSelf: number | null; avgManager: number | null;
  avgPeer: number | null; avgOverall: number | null;
  completedObjectives: number;
}

export interface FeedbackSummary {
  positive: number; neutral: number; constructive: number; total: number;
}

export interface AnalyticsData {
  scoreDistribution: { range: string; count: number }[];
  departmentComparison: { department: string; avgScore: string; count: number }[];
  teamBenchmarks: { managerId: string; managerName: string; avgScore: string; teamSize: number }[];
}

// ─── Request helper ─────────────────────────────────────────────────────────

/**
 * F3 Fase 3 — CSRF protection (double-submit cookie).
 * Lee la cookie csrf_token (no httpOnly, asi JS la puede leer) y la
 * envia en el header X-CSRF-Token en cada request mutante. El backend
 * (CsrfGuard) valida que coincidan: si un atacante cross-site dispara
 * un fetch desde su origen, el navegador adjunta la cookie de sesion
 * pero NO el header (porque el atacante no puede leer la cookie del
 * victim). El guard rechaza con 403.
 */
function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(
  path: string,
  options: RequestInit = {},
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _token?: string,
): Promise<T> {
  // F3 Fase 2 — Auth basada en cookie httpOnly. El navegador adjunta
  // automaticamente la cookie 'access_token' cuando se envia
  // credentials: 'include'. Ya no mandamos Authorization: Bearer en
  // headers — el JWT no esta en JavaScript, vive solo en la cookie
  // (no readable por XSS). El parametro `_token` se mantiene en la
  // firma para que los callers existentes no rompan; se ignora.
  //
  // FormData: cuando el body es FormData (file uploads multipart) NO
  // seteamos Content-Type — el navegador lo setea automaticamente con
  // el boundary correcto. Si forzamos application/json el server no
  // puede parsear el multipart.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };

  // F3 Fase 3 — Anadir X-CSRF-Token en metodos mutantes si tenemos
  // cookie. El backend valida via double-submit (header == cookie).
  const method = (options.method || "GET").toUpperCase();
  if (CSRF_PROTECTED_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    // If 401 Unauthorized, clear stale/demo auth and redirect to login
    // Skip redirect for:
    //   - auth endpoints (login, reset-password) so error messages show inline
    //   - public endpoints (unsubscribe, etc.) whose 401 means "bad token in URL"
    //     and NOT "session expired"; redirecting would trash the user's context.
    const isAuthEndpoint = path.startsWith("/auth/");
    const isPublicEndpoint = path.startsWith("/public/");
    if (res.status === 401 && typeof window !== "undefined" && !isAuthEndpoint && !isPublicEndpoint) {
      localStorage.removeItem("evapro-auth");
      window.location.href = "/login";
      throw new Error("Sesión expirada");
    }
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? "Error en la solicitud");
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text || !text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

// ─── API object ─────────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (email: string, password: string, tenantSlug?: string, twoFactorCode?: string) =>
      request<AuthTokens>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, tenantSlug, twoFactorCode }),
      }),
    changePassword: (email: string, currentPassword: string, newPassword: string, tenantSlug?: string) =>
      request<any>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ email, currentPassword, newPassword, tenantSlug }),
      }),
    setup2FA: (token: string) =>
      request<{ secret: string; uri: string }>("/auth/2fa/setup", { method: "POST" }, token),
    enable2FA: (token: string, code: string) =>
      request<{ enabled: boolean }>("/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }, token),
    disable2FA: (token: string, password: string) =>
      request<{ disabled: boolean }>("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) }, token),
    /** F3 Fase 2 — Logout server-side: limpia la cookie httpOnly del
     *  access_token. El frontend ademas limpia su propio estado
     *  (Zustand, react-query, sentry) en el handler logout() del store. */
    logout: () =>
      request<{ ok: true }>("/auth/logout", { method: "POST" }),
    /** F3 Fase 2 — Refresh con cookies. El backend setea una nueva
     *  cookie con el JWT renovado y devuelve { access_token } en el body
     *  para que el frontend pueda decodificar el nuevo `exp`. */
    refresh: () =>
      request<{ access_token: string }>("/auth/refresh", { method: "POST" }),
  },

  tenants: {
    me: (token: string) => request<Tenant>("/tenants/me", {}, token),
    feedbackConfig: (token: string) => request<any>("/tenants/me/feedback-config", {}, token),
    list: (token: string) => request<Tenant[]>("/tenants", {}, token),
    getById: (token: string, id: string) => request<Tenant>(`/tenants/${id}`, {}, token),
    create: (data: any, token: string) =>
      request<any>("/tenants", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) =>
      request<Tenant>(`/tenants/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deactivate: (token: string, id: string) =>
      request<void>(`/tenants/${id}`, { method: "DELETE" }, token),
    bulkOnboard: (token: string, data: any) =>
      request<any>("/tenants/bulk-onboard", { method: "POST", body: JSON.stringify(data) }, token),
    systemStats: (token: string) => request<any>("/tenants/system-stats", {}, token),
    usageMetrics: (token: string) => request<any>("/tenants/usage-metrics", {}, token),
    aiUsage: (token: string) => request<any[]>("/tenants/ai-usage", {}, token),
    getAllCustomSettings: (token: string) =>
      request<Record<string, string[]>>("/tenants/me/custom-settings", {}, token),
    getCustomSetting: (token: string, key: string) =>
      request<string[]>(`/tenants/me/custom-settings/${key}`, {}, token),
    updateCustomSetting: (token: string, key: string, values: string[]) =>
      request<string[]>(`/tenants/me/custom-settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ values }),
      }, token),
    checkSettingUsage: (token: string, key: string, value: string) =>
      request<{ inUse: boolean; count: number; entity: string; message: string }>(
        `/tenants/me/custom-settings/${key}/check-usage?value=${encodeURIComponent(value)}`, {}, token),
    updateSettings: (token: string, settings: Record<string, any>) =>
      request<any>("/tenants/me/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      }, token),
    getOnboardingProgress: (token: string) =>
      request<any>("/tenants/me/onboarding-progress", {}, token),
    // Departments table CRUD
    getDepartmentsTable: (token: string) =>
      request<DepartmentData[]>("/tenants/me/departments", {}, token),
    getDepartmentsForTenant: (token: string, tenantId: string) =>
      request<DepartmentData[]>(`/tenants/${tenantId}/departments`, {}, token),
    getPositionsForTenant: (token: string, tenantId: string) =>
      request<PositionData[]>(`/tenants/${tenantId}/positions`, {}, token),
    createDepartmentRecord: (token: string, data: { name: string; sortOrder?: number }) =>
      request<DepartmentData>("/tenants/me/departments", { method: "POST", body: JSON.stringify(data) }, token),
    updateDepartmentRecord: (token: string, id: string, data: { name?: string; sortOrder?: number; isActive?: boolean }) =>
      request<DepartmentData>(`/tenants/me/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deleteDepartmentRecord: (token: string, id: string) =>
      request<void>(`/tenants/me/departments/${id}`, { method: "DELETE" }, token),
    // Positions table CRUD (v2)
    getPositionsV2: (token: string) =>
      request<PositionData[]>("/tenants/me/positions-v2", {}, token),
    createPositionRecord: (token: string, data: { name: string; level?: number }) =>
      request<PositionData>("/tenants/me/positions-v2", { method: "POST", body: JSON.stringify(data) }, token),
    updatePositionRecord: (token: string, id: string, data: { name?: string; level?: number; isActive?: boolean }) =>
      request<PositionData>(`/tenants/me/positions-v2/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deletePositionRecord: (token: string, id: string) =>
      request<void>(`/tenants/me/positions-v2/${id}`, { method: "DELETE" }, token),
    // Positions catalog (legacy)
    getPositionsCatalog: (token: string) =>
      request<{ name: string; level: number }[]>("/tenants/me/positions", {}, token),
    getPositionsAll: (token: string) =>
      request<{ name: string; level: number }[]>("/tenants/me/positions/all", {}, token),
    setPositionsCatalog: (token: string, positions: { name: string; level: number }[]) =>
      request<{ name: string; level: number }[]>("/tenants/me/positions", {
        method: "PUT",
        body: JSON.stringify({ positions }),
      }, token),
    checkPositionUsage: (token: string, name: string) =>
      request<{ inUse: boolean; count: number }>(`/tenants/me/positions/check-usage?name=${encodeURIComponent(name)}`, {}, token),
    listTickets: (token: string) => request<any[]>("/tenants/me/tickets", {}, token),
    createTicket: (token: string, data: any) =>
      request<any>("/tenants/me/tickets", { method: "POST", body: JSON.stringify(data) }, token),
    listAllTickets: (token: string) => request<any[]>("/tenants/tickets/all", {}, token),
    respondTicket: (token: string, ticketId: string, response: string, status?: string, responseAttachments?: any[]) =>
      request<any>(`/tenants/tickets/${ticketId}/respond`, { method: "PATCH", body: JSON.stringify({ response, status, responseAttachments }) }, token),
  },

  auditLogs: {
    list: (token: string, page = 1, limit = 50, filters?: { action?: string; tenantId?: string; dateFrom?: string; dateTo?: string; entityType?: string; searchText?: string }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters?.action) params.set('action', filters.action);
      if (filters?.tenantId) params.set('tenantId', filters.tenantId);
      if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters?.dateTo) params.set('dateTo', filters.dateTo);
      if (filters?.entityType) params.set('entityType', filters.entityType);
      if (filters?.searchText) params.set('searchText', filters.searchText);
      return request<any>(`/audit-logs?${params.toString()}`, {}, token);
    },
    tenant: (token: string, filters: { page?: number; limit?: number; dateFrom?: string; dateTo?: string; action?: string; entityType?: string; evidenceOnly?: boolean; searchText?: string } = {}) => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.limit) params.set('limit', String(filters.limit));
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.action) params.set('action', filters.action);
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.evidenceOnly) params.set('evidenceOnly', 'true');
      if (filters.searchText) params.set('searchText', filters.searchText);
      return request<any>(`/audit-logs/tenant?${params.toString()}`, {}, token);
    },
    /** Resumen de fallos operativos (cron/notification/access/system) — widget admin */
    failureSummary: (token: string, daysBack = 7) =>
      request<{
        daysBack: number;
        periodStart: string;
        counts: { 'cron.failed': number; 'notification.failed': number; 'access.denied': number; 'system.error': number };
        total: number;
        lastFailureAt: string | null;
      }>(`/audit-logs/tenant/failure-summary?daysBack=${daysBack}`, {}, token),
    exportCsv: (token: string, filters: { dateFrom?: string; dateTo?: string; entityType?: string; action?: string; evidenceOnly?: boolean; searchText?: string } = {}) => {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.action) params.set('action', filters.action);
      if (filters.evidenceOnly) params.set('evidenceOnly', 'true');
      if (filters.searchText) params.set('searchText', filters.searchText);
      const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
      return fetch(`${BASE}/audit-logs/tenant/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error('Error al exportar CSV (' + r.status + ')');
        return r.blob();
      });
    },
  },

  subscriptions: {
    list: (token: string) => request<any[]>("/subscriptions", {}, token),
    getById: (token: string, id: string) => request<any>(`/subscriptions/${id}`, {}, token),
    create: (token: string, data: any) =>
      request<any>("/subscriptions", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) =>
      request<any>(`/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    cancel: (token: string, id: string) =>
      request<void>(`/subscriptions/${id}`, { method: "DELETE" }, token),
    stats: (token: string) => request<any>("/subscriptions/stats", {}, token),
    mySubscription: (token: string) => request<any>("/subscriptions/my-subscription", {}, token),
    myPayments: (token: string) => request<any[]>("/subscriptions/my-payments", {}, token),
    getPayments: (token: string, id: string) => request<any[]>(`/subscriptions/${id}/payments`, {}, token),
    registerPayment: (token: string, id: string, data: any) =>
      request<any>(`/subscriptions/${id}/payments`, { method: "POST", body: JSON.stringify(data) }, token),
    updatePayment: (token: string, paymentId: string, data: any) =>
      request<any>(`/subscriptions/payments/${paymentId}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deletePayment: (token: string, paymentId: string) =>
      request<any>(`/subscriptions/payments/${paymentId}`, { method: "DELETE" }, token),
    plans: {
      list: (token: string) => request<any[]>("/subscriptions/plans", {}, token),
      create: (token: string, data: any) =>
        request<any>("/subscriptions/plans", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) =>
        request<any>(`/subscriptions/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      deactivate: (token: string, id: string) =>
        request<void>(`/subscriptions/plans/${id}`, { method: "DELETE" }, token),
      pricing: (token: string, id: string) =>
        request<any>(`/subscriptions/plans/${id}/pricing`, {}, token),
    },
    getProration: (token: string) =>
      request<{ credit: number; daysRemaining: number; totalDays: number }>("/subscriptions/my-subscription/proration", {}, token),
    toggleAutoRenew: (token: string, data: { autoRenew: boolean }) =>
      request<void>("/subscriptions/my-subscription/auto-renew", { method: "PATCH", body: JSON.stringify(data) }, token),
    createRequest: (token: string, data: { type: string; targetPlan?: string; targetBillingPeriod?: string; notes?: string }) =>
      request<any>("/subscriptions/requests", { method: "POST", body: JSON.stringify(data) }, token),
    myRequests: (token: string) =>
      request<any[]>("/subscriptions/requests/my", {}, token),
    pendingRequests: (token: string) =>
      request<any[]>("/subscriptions/requests/pending", {}, token),
    approveRequest: (token: string, id: string) =>
      request<void>(`/subscriptions/requests/${id}/approve`, { method: "PATCH" }, token),
    rejectRequest: (token: string, id: string, reason: string) =>
      request<void>(`/subscriptions/requests/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }, token),
    // AI Add-on Packs
    getAiPacks: (token: string) =>
      request<{ id: string; name: string; calls: number; monthlyPrice: number; currency: string }[]>("/subscriptions/ai-packs", {}, token),
    getAiAddon: (token: string) =>
      request<{ calls: number; price: number; packId: string | null }>("/subscriptions/ai-addon", {}, token),
    setAiAddon: (token: string, packId: string | null) =>
      request<any>("/subscriptions/ai-addon", { method: "PATCH", body: JSON.stringify({ packId }) }, token),
  },

  talent: {
    generate: (token: string, cycleId: string) =>
      request<any[]>(`/talent/generate/${cycleId}`, { method: "POST" }, token),
    /** Talento en cuadrantes 1-3 del 9-Box (alerta del CommandCenter admin) */
    riskCount: (token: string, cycleId?: string) =>
      request<{ count: number; cycleId: string | null; cycleName: string | null; quadrants: Record<string, number> }>(
        `/talent/risk-count${cycleId ? `?cycleId=${cycleId}` : ''}`, {}, token,
      ),
    findByCycle: (token: string, cycleId: string) =>
      request<any[]>(`/talent/cycle/${cycleId}`, {}, token),
    nineBox: (token: string, cycleId: string) =>
      request<any>(`/talent/cycle/${cycleId}/nine-box`, {}, token),
    segmentation: (token: string, cycleId: string) =>
      request<any>(`/talent/cycle/${cycleId}/segmentation`, {}, token),
    update: (token: string, id: string, data: any) =>
      request<any>(`/talent/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    userHistory: (token: string, userId: string) =>
      request<any[]>(`/talent/user/${userId}`, {}, token),
    calibration: {
      list: (token: string, cycleId?: string) =>
        request<any[]>(`/talent/calibration${cycleId ? `?cycleId=${cycleId}` : ''}`, {}, token),
      create: (token: string, data: any) =>
        request<any>("/talent/calibration", { method: "POST", body: JSON.stringify(data) }, token),
      detail: (token: string, id: string) =>
        request<any>(`/talent/calibration/${id}`, {}, token),
      preview: (token: string, id: string) =>
        request<any[]>(`/talent/calibration/${id}/preview`, {}, token),
      populate: (token: string, id: string, excludeUserIds?: string[]) =>
        request<any[]>(`/talent/calibration/${id}/populate`, { method: "POST", body: JSON.stringify({ excludeUserIds }) }, token),
      addEntry: (token: string, id: string, userId: string) =>
        request<any>(`/talent/calibration/${id}/add-entry`, { method: "POST", body: JSON.stringify({ userId }) }, token),
      removeEntry: (token: string, entryId: string) =>
        request<any>(`/talent/calibration/entry/${entryId}`, { method: "DELETE" }, token),
      updateEntry: (token: string, entryId: string, data: any) =>
        request<any>(`/talent/calibration/entry/${entryId}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      complete: (token: string, id: string) =>
        request<void>(`/talent/calibration/${id}/complete`, { method: "POST" }, token),
      getDistribution: (token: string, id: string) =>
        request<any>(`/talent/calibration/${id}/distribution`, {}, token),
    },
  },

  recruitment: {
    processes: {
      list: (token: string, status?: string) =>
        request<any[]>(`/recruitment/processes${status ? `?status=${status}` : ''}`, {}, token),
      create: (token: string, data: any) =>
        request<any>("/recruitment/processes", { method: "POST", body: JSON.stringify(data) }, token),
      get: (token: string, id: string) =>
        request<any>(`/recruitment/processes/${id}`, {}, token),
      update: (token: string, id: string, data: any) =>
        request<any>(`/recruitment/processes/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      comparative: (token: string, id: string) =>
        request<any>(`/recruitment/processes/${id}/comparative`, {}, token),
      aiRecommendation: (token: string, id: string) =>
        request<any>(`/recruitment/processes/${id}/ai-recommendation`, { method: "POST" }, token),
      recalculateScores: (token: string) =>
        request<{ updated: number }>("/recruitment/recalculate-scores", { method: "POST" }, token),
    },
    candidates: {
      add: (token: string, processId: string, data: any) =>
        request<any>(`/recruitment/processes/${processId}/candidates`, { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) =>
        request<any>(`/recruitment/candidates/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      updateStage: (token: string, id: string, stage: string) =>
        request<any>(`/recruitment/candidates/${id}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) }, token),
      profile: (token: string, id: string) =>
        request<any>(`/recruitment/candidates/${id}/profile`, {}, token),
      uploadCv: (token: string, id: string, cvUrl: string) =>
        request<any>(`/recruitment/candidates/${id}/cv`, { method: "PATCH", body: JSON.stringify({ cvUrl }) }, token),
      analyzeCv: (token: string, id: string) =>
        request<any>(`/recruitment/candidates/${id}/analyze-cv`, { method: "POST" }, token),
      getCvAnalysis: (token: string, id: string) =>
        request<any>(`/recruitment/candidates/${id}/cv-analysis`, {}, token),
      addNotes: (token: string, id: string, notes: string) =>
        request<any>(`/recruitment/candidates/${id}/notes`, { method: "PATCH", body: JSON.stringify({ notes }) }, token),
      submitInterview: (token: string, id: string, data: any) =>
        request<any>(`/recruitment/candidates/${id}/interview`, { method: "POST", body: JSON.stringify(data) }, token),
      getInterviews: (token: string, id: string) =>
        request<any[]>(`/recruitment/candidates/${id}/interviews`, {}, token),
      scorecard: (token: string, id: string) =>
        request<any>(`/recruitment/candidates/${id}/scorecard`, {}, token),
      adjustScore: (token: string, id: string, adjustment: number, justification: string) =>
        request<any>(`/recruitment/candidates/${id}/adjust-score`, { method: "PATCH", body: JSON.stringify({ adjustment, justification }) }, token),
    },
  },

  users: {
    list: (token: string, page = 1, limit = 10, filters?: { search?: string; department?: string; role?: string; position?: string; status?: string; tenantId?: string }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters?.search) params.set('search', filters.search);
      if (filters?.department) params.set('department', filters.department);
      if (filters?.role) params.set('role', filters.role);
      if (filters?.position) params.set('position', filters.position);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.tenantId) params.set('tenantId', filters.tenantId);
      return request<PaginatedResponse<UserData>>(`/users?${params.toString()}`, {}, token);
    },
    me: (token: string) =>
      request<UserData>("/users/me", {}, token),
    uploadCv: async (token: string, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/users/me/cv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Error al subir CV'); }
      return res.json() as Promise<{ cvUrl: string; cvFileName: string }>;
    },
    deleteCv: (token: string) =>
      request<{ deleted: boolean }>("/users/me/cv", { method: "DELETE" }, token),
    getById: (token: string, id: string) =>
      request<UserData>(`/users/${id}`, {}, token),
    create: (token: string, data: any) =>
      request<UserData>("/users", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) =>
      request<UserData>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    remove: (token: string, id: string) =>
      request<void>(`/users/${id}`, { method: "DELETE" }, token),
    bulkImport: (token: string, csv: string) =>
      request<BulkImportData>("/users/bulk-import", { method: "POST", body: JSON.stringify({ csv }) }, token),
    getBulkImport: (token: string, id: string) =>
      request<BulkImportData>(`/users/bulk-imports/${id}`, {}, token),
    listNotes: (token: string, userId: string) =>
      request<UserNoteData[]>(`/users/${userId}/notes`, {}, token),
    createNote: (token: string, userId: string, data: { title: string; content: string; category?: string; isConfidential?: boolean }) =>
      request<UserNoteData>(`/users/${userId}/notes`, { method: "POST", body: JSON.stringify(data) }, token),
    updateNote: (token: string, userId: string, noteId: string, data: any) =>
      request<UserNoteData>(`/users/${userId}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deleteNote: (token: string, userId: string, noteId: string) =>
      request<void>(`/users/${userId}/notes/${noteId}`, { method: "DELETE" }, token),
    resendInvite: (token: string, userId: string) =>
      request<{ ok: boolean }>(`/users/${userId}/resend-invite`, { method: "POST" }, token),
    inviteBulk: (token: string, data: { emails: string[]; role?: string }) =>
      request<{ invited: number; skipped: string[] }>("/users/invite-bulk", { method: "POST", body: JSON.stringify(data) }, token),
    normalizeDepartments: (token: string, apply = false) =>
      request<{ mismatches: any[]; fixed: number }>(`/users/normalize-departments?apply=${apply}`, { method: "POST" }, token),
    orgChart: (token: string) =>
      request<any[]>("/users/org-chart", {}, token),
    registerDeparture: (
      token: string,
      userId: string,
      dto: {
        departureType: string;
        departureDate: string;
        isVoluntary: boolean;
        reasonCategory?: string;
        reasonDetail?: string;
        wouldRehire?: boolean | null;
        reassignToManagerId?: string | null;
      },
    ) =>
      request<any>(`/users/${userId}/departure`, {
        method: "POST",
        body: JSON.stringify(dto),
      }, token),
    listDepartures: (token: string, userId: string) =>
      request<any[]>(`/users/${userId}/departures`, {}, token),
    listMovements: (token: string, userId: string) =>
      request<any[]>(`/users/${userId}/movements`, {}, token),
    registerMovement: (
      token: string,
      userId: string,
      dto: {
        movementType: string;
        effectiveDate: string;
        fromDepartment?: string;
        toDepartment?: string;
        fromPosition?: string;
        toPosition?: string;
        reason?: string;
      },
    ) =>
      request<any>(`/users/${userId}/movement`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }, token),
    reactivate: (
      token: string,
      userId: string,
      dto: { reasonForReactivation?: string; managerId?: string | null } = {},
    ) =>
      request<{ ok: boolean; tempPasswordSentTo: string }>(`/users/${userId}/reactivate`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }, token),
    updateDeparture: (
      token: string,
      userId: string,
      departureId: string,
      dto: { reasonCategory?: string | null; reasonDetail?: string | null; wouldRehire?: boolean | null },
    ) =>
      request<any>(`/users/${userId}/departures/${departureId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }, token),
    cancelDeparture: (token: string, userId: string, departureId: string, reason?: string) =>
      request<{ ok: boolean; reactivated: boolean }>(`/users/${userId}/departures/${departureId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason || undefined }),
      }, token),
  },

  cycles: {
    list: (token: string) =>
      request<CycleData[]>("/evaluation-cycles", {}, token),
    getById: (token: string, id: string) =>
      request<CycleData>(`/evaluation-cycles/${id}`, {}, token),
    create: (token: string, data: any) =>
      request<CycleData>("/evaluation-cycles", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) =>
      request<CycleData>(`/evaluation-cycles/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    remove: (token: string, id: string) =>
      request<void>(`/evaluation-cycles/${id}`, { method: "DELETE" }, token),
    launch: (token: string, id: string) =>
      request<{ cycle: CycleData; assignmentsCreated: number }>(
        `/evaluation-cycles/${id}/launch`, { method: "POST" }, token,
      ),
    close: (token: string, id: string) =>
      request<CycleData>(`/evaluation-cycles/${id}/close`, { method: "POST" }, token),
    getAssignments: (token: string, cycleId: string) =>
      request<AssignmentData[]>(`/evaluation-cycles/${cycleId}/assignments`, {}, token),
  },

  evaluations: {
    pending: (token: string) =>
      request<AssignmentData[]>("/evaluations/pending", {}, token),
    completed: (token: string) =>
      request<AssignmentData[]>("/evaluations/completed", {}, token),
    received: (token: string) =>
      request<any[]>("/evaluations/received", {}, token),
    /** Variantes paginadas — pasan ?search/?cycleId/?page/?limit y devuelven
     *  PaginatedResponse<T> ({ data, total, page, limit }). El backend
     *  responde `{ items, total }`; aca se mapea a la convencion frontend
     *  para consistencia con users.list y futuras paginaciones. */
    pendingPaged: (token: string, opts: EvalListParams) =>
      request<{ items: AssignmentData[]; total: number }>(
        `/evaluations/pending${buildEvalQuery(opts)}`,
        {},
        token,
      ).then(
        (r): PaginatedResponse<AssignmentData> => ({
          data: r.items,
          total: r.total,
          page: opts.page ?? 1,
          limit: opts.limit ?? 0,
        }),
      ),
    completedPaged: (token: string, opts: EvalListParams) =>
      request<{ items: AssignmentData[]; total: number }>(
        `/evaluations/completed${buildEvalQuery(opts)}`,
        {},
        token,
      ).then(
        (r): PaginatedResponse<AssignmentData> => ({
          data: r.items,
          total: r.total,
          page: opts.page ?? 1,
          limit: opts.limit ?? 0,
        }),
      ),
    receivedPaged: (token: string, opts: EvalListParams) =>
      request<{ items: AssignmentData[]; total: number }>(
        `/evaluations/received${buildEvalQuery(opts)}`,
        {},
        token,
      ).then(
        (r): PaginatedResponse<AssignmentData> => ({
          data: r.items,
          total: r.total,
          page: opts.page ?? 1,
          limit: opts.limit ?? 0,
        }),
      ),
    /** Evaluaciones RECIBIDAS por miembros del equipo del manager —
     *  incluye autoevaluaciones, peer, manager, direct_report y
     *  external. A diferencia de completed/Paged (que es Carlos como
     *  evaluador), este endpoint muestra TODO lo que el equipo
     *  recibe de cualquier evaluador. Roles: super_admin/tenant_admin
     *  (ven todo el tenant) y manager (solo sus directos). */
    teamReceived: (token: string) =>
      request<AssignmentData[]>('/evaluations/team-received', {}, token),
    teamReceivedPaged: (token: string, opts: EvalListParams) =>
      request<{ items: AssignmentData[]; total: number }>(
        `/evaluations/team-received${buildEvalQuery(opts)}`,
        {},
        token,
      ).then(
        (r): PaginatedResponse<AssignmentData> => ({
          data: r.items,
          total: r.total,
          page: opts.page ?? 1,
          limit: opts.limit ?? 0,
        }),
      ),
    /** Stats agregados — KPI cards source-of-truth (cuentas reales, no
     *  page-local). */
    stats: (token: string) =>
      request<EvalStatsResponse>('/evaluations/stats', {}, token),
    /** Lista evaluaciones RECIBIDAS por un user arbitrario — requiere
     *  permisos admin/manager (o ser el propio user). Útil para la ficha de
     *  colaborador donde el manager ve la retroalimentación de su equipo. */
    receivedByUser: (token: string, userId: string) =>
      request<any[]>(`/users/${userId}/received-evaluations`, {}, token),
    getDetail: (token: string, assignmentId: string) =>
      request<{ assignment: AssignmentData; template: TemplateData | null; response: ResponseData | null }>(
        `/evaluations/${assignmentId}`, {}, token,
      ),
    saveResponse: (token: string, assignmentId: string, answers: any) =>
      request<ResponseData>(
        `/evaluations/${assignmentId}/responses`,
        { method: "POST", body: JSON.stringify({ answers }) }, token,
      ),
    updateResponse: (token: string, assignmentId: string, answers: any) =>
      request<ResponseData>(
        `/evaluations/${assignmentId}/responses`,
        { method: "PATCH", body: JSON.stringify({ answers }) }, token,
      ),
    submit: (token: string, assignmentId: string, answers: any) =>
      request<{ assignment: AssignmentData; response: ResponseData }>(
        `/evaluations/${assignmentId}/submit`,
        { method: "POST", body: JSON.stringify({ answers }) }, token,
      ),
  },

  templates: {
    list: (token: string) =>
      request<TemplateData[]>("/templates", {}, token),
    getById: (token: string, id: string) =>
      request<TemplateData>(`/templates/${id}`, {}, token),
    create: (token: string, data: any) =>
      request<TemplateData>("/templates", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) =>
      request<TemplateData>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    remove: (token: string, id: string) =>
      request<void>(`/templates/${id}`, { method: "DELETE" }, token),
    duplicate: (token: string, id: string) =>
      request<TemplateData>(`/templates/${id}/duplicate`, { method: "POST" }, token),
    generateSamples: (token: string) =>
      request<TemplateData[]>("/templates/generate-samples", { method: "POST" }, token),
    importCsv: (token: string, data: { name: string; description?: string; csvData: string }) =>
      request<TemplateData>(`/templates/import-csv`, { method: "POST", body: JSON.stringify(data) }, token),
    preview: (token: string, id: string) =>
      request<any>(`/templates/${id}/preview`, {}, token),
    versionHistory: (token: string, id: string) =>
      request<any>(`/templates/${id}/versions`, {}, token),
    restoreVersion: (token: string, id: string, version: number) =>
      request<TemplateData>(`/templates/${id}/restore/${version}`, { method: "POST" }, token),
    propose: (token: string, data: any) =>
      request<TemplateData>("/templates/propose", { method: "POST", body: JSON.stringify(data) }, token),
    pending: (token: string) =>
      request<TemplateData[]>("/templates/pending", {}, token),
    publish: (token: string, id: string, note?: string) =>
      request<TemplateData>(`/templates/${id}/publish`, { method: "POST", body: JSON.stringify({ note }) }, token),
    reject: (token: string, id: string, note: string) =>
      request<TemplateData>(`/templates/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }, token),

    // ─── Fase 3 (Opción A): subplantillas ──────────────────────────────
    /** Devuelve template padre + subplantillas (con migración inline legacy si aplica). */
    getWithSubTemplates: (token: string, id: string) =>
      request<{ template: TemplateData; subTemplates: any[] }>(
        `/templates/${id}/sub-templates`, {}, token,
      ),
    createSubTemplate: (token: string, parentId: string, data: any) =>
      request<any>(`/templates/${parentId}/sub-templates`,
        { method: "POST", body: JSON.stringify(data) }, token),
    updateSubTemplate: (token: string, subId: string, data: any) =>
      request<any>(`/templates/sub-templates/${subId}`,
        { method: "PATCH", body: JSON.stringify(data) }, token),
    deleteSubTemplate: (token: string, subId: string) =>
      request<void>(`/templates/sub-templates/${subId}`, { method: "DELETE" }, token),
    /** Update batch de pesos. Body: { weights: { manager: 0.4, ... } } */
    updateWeights: (token: string, parentId: string, weights: Record<string, number>) =>
      request<any[]>(`/templates/${parentId}/sub-templates/weights`,
        { method: "PUT", body: JSON.stringify({ weights }) }, token),
  },

  peerAssignments: {
    list: (token: string, cycleId: string) =>
      request<PeerAssignmentData[]>(`/evaluation-cycles/${cycleId}/peer-assignments`, {}, token),
    add: (token: string, cycleId: string, data: { evaluateeId: string; evaluatorId: string; relationType?: string }) =>
      request<PeerAssignmentData>(`/evaluation-cycles/${cycleId}/peer-assignments`, { method: "POST", body: JSON.stringify(data) }, token),
    bulkAdd: (token: string, cycleId: string, assignments: { evaluateeId: string; evaluatorId: string }[]) =>
      request<PeerAssignmentData[]>(`/evaluation-cycles/${cycleId}/peer-assignments/bulk`, { method: "POST", body: JSON.stringify({ assignments }) }, token),
    remove: (token: string, cycleId: string, id: string) =>
      request<void>(`/evaluation-cycles/${cycleId}/peer-assignments/${id}`, { method: "DELETE" }, token),
    allowedRelations: (token: string, cycleId: string) =>
      request<{ value: string; label: string }[]>(`/evaluation-cycles/${cycleId}/allowed-relations`, {}, token),
    autoGenerate: (token: string, cycleId: string) =>
      request<{
        created: number;
        skipped: number;
        exceptions: Array<{
          evaluateeId: string;
          evaluateeName: string;
          department: string | null;
          type: string;
          message: string;
          relationType: string;
          available?: number;
          required?: number;
        }>;
      }>(`/evaluation-cycles/${cycleId}/auto-generate`, { method: "POST" }, token),
    suggestPeers: (token: string, cycleId: string, evaluateeId: string) =>
      request<any[]>(`/evaluation-cycles/${cycleId}/suggest-peers/${evaluateeId}`, {}, token),
  },

  feedback: {
    createCheckIn: (token: string, data: any) =>
      request<CheckInData>("/feedback/checkins", { method: "POST", body: JSON.stringify(data) }, token),
    listCheckIns: (token: string) =>
      request<CheckInData[]>("/feedback/checkins", {}, token),
    /** v3.1 — Historial de temas para autocompletar. Admin ve todos los del
     *  tenant; manager solo los que él creó; employee retorna []. */
    getMyTopicsHistory: (token: string) =>
      request<Array<{
        title: string;
        usedCount: number;
        lastUsedAt: string;
        history: Array<{ employeeName: string; date: string }>;
      }>>("/feedback/my-topics", {}, token),
    updateCheckIn: (token: string, id: string, data: any) =>
      request<CheckInData>(`/feedback/checkins/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    completeCheckIn: (token: string, id: string, data?: { notes?: string; actionItems?: any[]; rating?: number; minutes?: string }) =>
      request<CheckInData>(`/feedback/checkins/${id}/complete`, { method: "POST", ...(data ? { body: JSON.stringify(data) } : {}) }, token),
    /** Permite a cualquier participante (manager/employee) proponer un tema
     *  para el 1:1. Solo funciona si el check-in está scheduled. */
    addTopicToCheckIn: (token: string, id: string, text: string) =>
      request<CheckInData>(
        `/feedback/checkins/${id}/add-topic`,
        { method: 'PATCH', body: JSON.stringify({ text }) },
        token,
      ),
    /** v3.1 — Edición retroactiva de check-in COMPLETED (ej. auto-cerrado
     *  por el cron +5 días). Solo manager del checkin + admin. */
    editCompletedCheckIn: (
      token: string,
      id: string,
      data: {
        notes?: string;
        minutes?: string;
        rating?: number;
        actionItems?: Array<{ text: string; completed?: boolean; assigneeName?: string; dueDate?: string }>;
      },
    ) =>
      request<CheckInData>(
        `/feedback/checkins/${id}/retroactive-info`,
        { method: 'PATCH', body: JSON.stringify(data) },
        token,
      ),
    updateMinutes: (token: string, id: string, minutes: string) =>
      request<CheckInData>(`/feedback/checkins/${id}/minutes`, { method: "PATCH", body: JSON.stringify({ minutes }) }, token),
    deleteCheckIn: (token: string, id: string) =>
      request<{ deleted: boolean }>(`/feedback/checkins/${id}`, { method: "DELETE" }, token),
    requestCheckIn: (token: string, data: { topic: string; suggestedDate?: string }) =>
      request<CheckInData>("/feedback/checkins/request", { method: "POST", body: JSON.stringify(data) }, token),
    acceptCheckInRequest: (token: string, id: string, data?: { scheduledDate?: string; scheduledTime?: string; locationId?: string }) =>
      request<CheckInData>(`/feedback/checkins/${id}/accept`, { method: "POST", ...(data ? { body: JSON.stringify(data) } : {}) }, token),
    sendQuickFeedback: (token: string, data: any) =>
      request<QuickFeedbackData>("/feedback/quick", { method: "POST", body: JSON.stringify(data) }, token),
    receivedFeedback: (token: string) =>
      request<QuickFeedbackData[]>("/feedback/quick/received", {}, token),
    givenFeedback: (token: string) =>
      request<QuickFeedbackData[]>("/feedback/quick/given", {}, token),
    summary: (token: string) =>
      request<FeedbackSummary>("/feedback/quick/summary", {}, token),
    rejectCheckIn: (token: string, id: string, reason: string) =>
      request<CheckInData>(`/feedback/checkins/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, token),
    listLocations: (token: string) =>
      request<any[]>("/feedback/meeting-locations", {}, token),
    createLocation: (token: string, data: any) =>
      request<any>("/feedback/meeting-locations", { method: "POST", body: JSON.stringify(data) }, token),
    updateLocation: (token: string, id: string, data: any) =>
      request<any>(`/feedback/meeting-locations/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deleteLocation: (token: string, id: string) =>
      request<void>(`/feedback/meeting-locations/${id}`, { method: "DELETE" }, token),

    // ─── v3.1 F1 — Agenda Mágica de 1:1 ────────────────────────────────
    /** Retorna el magicAgenda generado (o null si nunca se generó) + carried-over items. */
    getMagicAgenda: (token: string, checkinId: string) =>
      request<{
        magicAgenda: {
          pendingFromPrevious: Array<{ text: string; addedByUserId: string; addedByName?: string; previousCheckinId: string }>;
          okrSnapshot: Array<{ objectiveId: string; title: string; progress: number; status: string; targetDate: string | null; daysToTarget: number | null }>;
          recentFeedback: Array<{ feedbackId: string; fromUserId: string; fromName?: string; sentiment: string; messagePreview: string; createdAt: string }>;
          recentRecognitions: Array<{ recognitionId: string; valueId: string | null; valueName?: string; messagePreview: string; createdAt: string }>;
          aiSuggestedTopics: Array<{ id: string; topic: string; rationale: string; priority: 'high' | 'med' | 'low'; dismissed?: boolean }>;
          generatedAt: string;
          generatorVersion: string;
        } | null;
        carriedOverActionItems: Array<{ text: string; assigneeName?: string; dueDate?: string | null; previousCheckinId: string; previousCheckinDate: string }>;
        hasAi: boolean;
      }>(`/feedback/checkins/${checkinId}/agenda`, {}, token),

    /** Genera la agenda on-demand.
     *  - force=true regenera incluso si ya existe (consume IA si includeAi).
     *  - includeAi=false salta la llamada a Anthropic (NO quema crédito).
     *    Los 4 bloques de datos (pendientes, OKRs, feedback, reconocimientos)
     *    se pueblan igual porque son queries SQL gratis.
     *  - includeAi default true (mantiene comportamiento v3.0 donde IA siempre
     *    se llamaba si el plan la tenía). */
    generateMagicAgenda: (
      token: string,
      checkinId: string,
      opts?: { force?: boolean; includeAi?: boolean },
    ) =>
      request<CheckInData>(
        `/feedback/checkins/${checkinId}/agenda/generate`,
        {
          method: 'POST',
          body: JSON.stringify({
            force: !!opts?.force,
            includeAi: opts?.includeAi !== false,
          }),
        },
        token,
      ),

    /** Dismissea sugerencias IA (no borra, solo marca). */
    patchMagicAgenda: (token: string, checkinId: string, dismissedSuggestionIds: string[]) =>
      request<CheckInData>(
        `/feedback/checkins/${checkinId}/agenda`,
        { method: 'PATCH', body: JSON.stringify({ dismissedSuggestionIds }) },
        token,
      ),
  },

  // ─── v3.1 Tema B — Team Meetings (N participantes) ────────────────────
  teamMeetings: {
    list: (token: string) =>
      request<TeamMeetingData[]>('/team-meetings', {}, token),
    getById: (token: string, id: string) =>
      request<TeamMeetingData>(`/team-meetings/${id}`, {}, token),
    create: (token: string, data: {
      title: string;
      description?: string;
      scheduledDate: string;
      scheduledTime?: string;
      locationId?: string;
      participantIds: string[];
    }) =>
      request<TeamMeetingData>(
        '/team-meetings',
        { method: 'POST', body: JSON.stringify(data) },
        token,
      ),
    update: (token: string, id: string, data: any) =>
      request<TeamMeetingData>(
        `/team-meetings/${id}`,
        { method: 'PATCH', body: JSON.stringify(data) },
        token,
      ),
    cancel: (token: string, id: string, reason?: string) =>
      request<TeamMeetingData>(
        `/team-meetings/${id}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason }) },
        token,
      ),
    complete: (token: string, id: string, data: {
      notes?: string;
      minutes?: string;
      rating?: number;
      actionItems?: Array<{ text: string; completed?: boolean; assigneeName?: string; dueDate?: string }>;
    }) =>
      request<TeamMeetingData>(
        `/team-meetings/${id}/complete`,
        { method: 'POST', body: JSON.stringify(data) },
        token,
      ),
    respond: (token: string, id: string, status: 'accepted' | 'declined', declineReason?: string) =>
      request<any>(
        `/team-meetings/${id}/respond`,
        { method: 'POST', body: JSON.stringify({ status, declineReason }) },
        token,
      ),
    addTopic: (token: string, id: string, text: string) =>
      request<TeamMeetingData>(
        `/team-meetings/${id}/topics`,
        { method: 'PATCH', body: JSON.stringify({ text }) },
        token,
      ),
    editCompleted: (
      token: string,
      id: string,
      data: {
        notes?: string;
        minutes?: string;
        rating?: number;
        actionItems?: Array<{ text: string; completed?: boolean; assigneeName?: string; dueDate?: string }>;
      },
    ) =>
      request<TeamMeetingData>(
        `/team-meetings/${id}/retroactive-info`,
        { method: 'PATCH', body: JSON.stringify(data) },
        token,
      ),
  },

  // ─── v3.1 F3 — Mood Tracking ──────────────────────────────────────────
  moodCheckins: {
    /** Registra o actualiza el mood del día actual (upsert). */
    submit: (token: string, data: { score: number; note?: string }) =>
      request<MoodCheckinData>(
        '/mood-checkins',
        { method: 'POST', body: JSON.stringify(data) },
        token,
      ),
    /** Registro de hoy del caller (null si no registró). */
    getToday: (token: string) =>
      request<MoodCheckinData | null>('/mood-checkins/me/today', {}, token),
    /** Histórico personal (default 30 días, max 180). */
    getMyHistory: (token: string, days?: number) =>
      request<MoodCheckinData[]>(
        `/mood-checkins/me/history${days ? `?days=${days}` : ''}`,
        {},
        token,
      ),
    /** Agregado del equipo por día (solo manager/admin). */
    getTeamHistory: (token: string, days?: number) =>
      request<Array<{ date: string; avgScore: number; responseCount: number }>>(
        `/mood-checkins/team/history${days ? `?days=${days}` : ''}`,
        {},
        token,
      ),
    /** Resumen de HOY del equipo (solo si hay >= 3 respuestas). */
    getTeamToday: (token: string) =>
      request<{
        date: string;
        avgScore: number;
        responseCount: number;
        distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
      } | null>('/mood-checkins/team/today', {}, token),
  },

  // ─── v3.1 F6 — Leader Streaks ─────────────────────────────────────────
  leaderStreaks: {
    /** Mis streaks (manager/admin). */
    me: (token: string) =>
      request<LeaderStreaksData>('/leader-streaks/me', {}, token),
    /** Ranking del tenant (admin only). */
    tenant: (token: string) =>
      request<LeaderStreaksData[]>('/leader-streaks/tenant', {}, token),
  },

  objectives: {
    list: (token: string, userId?: string) =>
      request<ObjectiveData[]>(`/objectives${userId ? `?userId=${userId}` : ""}`, {}, token),
    getById: (token: string, id: string) =>
      request<ObjectiveData>(`/objectives/${id}`, {}, token),
    create: (token: string, data: any) =>
      request<ObjectiveData>("/objectives", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) =>
      request<ObjectiveData>(`/objectives/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    remove: (token: string, id: string) =>
      request<void>(`/objectives/${id}`, { method: "DELETE" }, token),
    addProgress: (token: string, id: string, data: any) =>
      request<ObjectiveUpdateData>(`/objectives/${id}/progress`, { method: "POST", body: JSON.stringify(data) }, token),
    history: (token: string, id: string) =>
      request<ObjectiveUpdateData[]>(`/objectives/${id}/history`, {}, token),
    listComments: (token: string, objectiveId: string) =>
      request<any[]>(`/objectives/${objectiveId}/comments`, {}, token),
    createComment: (token: string, objectiveId: string, data: { content: string; type?: string; attachmentUrl?: string; attachmentName?: string }) =>
      request<any>(`/objectives/${objectiveId}/comments`, { method: "POST", body: JSON.stringify(data) }, token),
    deleteComment: (token: string, objectiveId: string, commentId: string) =>
      request<void>(`/objectives/${objectiveId}/comments/${commentId}`, { method: "DELETE" }, token),
    submitForApproval: (token: string, id: string) =>
      request<ObjectiveData>(`/objectives/${id}/submit-for-approval`, { method: "POST" }, token),
    approve: (token: string, id: string) =>
      request<ObjectiveData>(`/objectives/${id}/approve`, { method: "POST" }, token),
    reject: (token: string, id: string, reason?: string) =>
      request<ObjectiveData>(`/objectives/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, token),
    atRisk: (token: string, userId?: string) =>
      request<ObjectiveData[]>(`/objectives/at-risk${userId ? `?userId=${userId}` : ""}`, {}, token),
    teamSummary: (token: string) =>
      request<any>("/objectives/team-summary", {}, token),
    listKeyResults: (token: string, objectiveId: string) =>
      request<any[]>(`/objectives/${objectiveId}/key-results`, {}, token),
    createKeyResult: (token: string, objectiveId: string, data: any) =>
      request<any>(`/objectives/${objectiveId}/key-results`, { method: "POST", body: JSON.stringify(data) }, token),
    updateKeyResult: (token: string, krId: string, data: any) =>
      request<any>(`/objectives/key-results/${krId}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deleteKeyResult: (token: string, krId: string) =>
      request<void>(`/objectives/key-results/${krId}`, { method: "DELETE" }, token),
    tree: (token: string) =>
      request<any[]>(`/objectives/tree`, {}, token),
  },

  reports: {
    executiveDashboard: (token: string, cycleId?: string, scope?: 'org') => {
      const params = new URLSearchParams();
      if (cycleId) params.set('cycleId', cycleId);
      if (scope) params.set('scope', scope);
      const qs = params.toString();
      return request<any>(`/reports/executive-dashboard${qs ? `?${qs}` : ''}`, {}, token);
    },
    closedSurveys: (token: string) =>
      request<any[]>("/reports/executive-dashboard/surveys", {}, token),
    enpsBySurvey: (token: string, surveyId: string) =>
      request<any>(`/reports/executive-dashboard/enps?surveyId=${surveyId}`, {}, token),
    crossAnalysis: (token: string, cycleIds?: string[], surveyId?: string) => {
      const params = new URLSearchParams();
      if (cycleIds?.length) params.set('cycleIds', cycleIds.join(','));
      if (surveyId) params.set('surveyId', surveyId);
      const qs = params.toString();
      return request<any>(`/reports/cross-analysis${qs ? `?${qs}` : ''}`, {}, token);
    },
    crossAnalysisAvailable: (token: string) =>
      request<{ cycles: any[]; surveys: any[] }>('/reports/cross-analysis/available', {}, token),
    cycleSummary: (token: string, cycleId: string, scope?: 'org') =>
      request<CycleSummary>(`/reports/cycle/${cycleId}/summary${scope ? '?scope=org' : ''}`, {}, token),
    individual: (token: string, cycleId: string, userId: string) =>
      request<any>(`/reports/cycle/${cycleId}/individual/${userId}`, {}, token),
    team: (token: string, cycleId: string, managerId: string) =>
      request<any>(`/reports/cycle/${cycleId}/team/${managerId}`, {}, token),
    exportCsv: (token: string, cycleId: string) =>
      `${BASE_URL}/reports/cycle/${cycleId}/export?format=csv`,
    exportPptx: (token: string, cycleId: string) =>
      `${BASE_URL}/reports/cycle/${cycleId}/export?format=pptx`,
    performanceHistory: (token: string, userId: string, cycleType?: string) =>
      request<{ userId: string; history: PerformanceHistoryEntry[] }>(
        `/reports/users/${userId}/performance-history${cycleType ? `?cycleType=${cycleType}` : ''}`, {}, token,
      ),
    analytics: (token: string, cycleId: string) =>
      request<AnalyticsData>(`/reports/analytics?cycleId=${cycleId}`, {}, token),
    competencyRadar: (token: string, cycleId: string, userId: string) =>
      request<any>(`/reports/cycle/${cycleId}/competency-radar/${userId}`, {}, token),
    selfVsOthers: (token: string, cycleId: string, userId: string) =>
      request<any>(`/reports/cycle/${cycleId}/self-vs-others/${userId}`, {}, token),
    heatmap: (token: string, cycleId: string) =>
      request<any>(`/reports/cycle/${cycleId}/heatmap`, {}, token),
    bellCurve: (token: string, cycleId: string) =>
      request<any>(`/reports/cycle/${cycleId}/bell-curve`, {}, token),
    gapAnalysisIndividual: (token: string, cycleId: string, userId: string) =>
      request<any>(`/reports/cycle/${cycleId}/gap-analysis/${userId}`, {}, token),
    gapAnalysisTeam: (token: string, cycleId: string, managerId: string) =>
      request<any>(`/reports/cycle/${cycleId}/gap-analysis-team/${managerId}`, {}, token),
    kpis: {
      list: (token: string) => request<any[]>("/reports/kpis", {}, token),
      calculate: (token: string) => request<any[]>("/reports/kpis/calculate", {}, token),
      create: (token: string, data: any) => request<any>("/reports/kpis", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/reports/kpis/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      deactivate: (token: string, id: string) => request<void>(`/reports/kpis/${id}`, { method: "DELETE" }, token),
    },
    competencyHeatmap: (token: string, cycleId: string, filters?: { department?: string; position?: string }) => {
      const params = new URLSearchParams();
      if (filters?.department) params.set('department', filters.department);
      if (filters?.position) params.set('position', filters.position);
      const qs = params.toString() ? `?${params.toString()}` : '';
      return request<any>(`/reports/cycle/${cycleId}/competency-heatmap${qs}`, {}, token);
    },
    // Analytics endpoints for executive dashboard
    cycleComparison: (token: string) =>
      request<any>("/reports/analytics/cycle-comparison", {}, token),
    turnover: (token: string) =>
      request<any>("/reports/analytics/turnover", {}, token),
    movements: (token: string) =>
      request<any>("/reports/analytics/movements", {}, token),
    pdiCompliance: (token: string) =>
      request<any>("/reports/analytics/pdi-compliance", {}, token),
    pdiHistorical: (token: string) =>
      request<any>("/reports/analytics/pdi-historical", {}, token),
  },

  notifications: {
    list: (token: string, limit?: number) =>
      request<any[]>(`/notifications${limit ? `?limit=${limit}` : ''}`, {}, token),
    unreadCount: (token: string) =>
      request<{ count: number }>("/notifications/unread-count", {}, token),
    markAsRead: (token: string, id: string) =>
      request<any>(`/notifications/${id}/read`, { method: "PATCH" }, token),
    markAllAsRead: (token: string) =>
      request<void>("/notifications/read-all", { method: "PATCH" }, token),
    deleteOne: (token: string, id: string) =>
      request<void>(`/notifications/${id}`, { method: "DELETE" }, token),
    deleteAllRead: (token: string) =>
      request<{ deleted: number }>("/notifications/read", { method: "DELETE" }, token),
    getPreferences: (token: string) =>
      request<Record<string, boolean>>("/notifications/preferences", {}, token),
    updatePreferences: (token: string, prefs: Record<string, boolean>) =>
      request<void>("/notifications/preferences", { method: "PATCH", body: JSON.stringify(prefs) }, token),
    cleanupOrphans: (token: string) =>
      request<{ surveys: number; cycles: number; old: number }>("/notifications/cleanup", { method: "POST" }, token),
  },

  dashboard: {
    stats: (token: string) =>
      request<DashboardStats>("/dashboard/stats", {}, token),
    nextActions: (token: string) =>
      request<any>("/dashboard/next-actions", {}, token),
  },

  development: {
    competencies: {
      list: (token: string) => request<any[]>("/development/competencies", {}, token),
      create: (token: string, data: any) => request<any>("/development/competencies", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/development/competencies/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      deactivate: (token: string, id: string) => request<void>(`/development/competencies/${id}`, { method: "DELETE" }, token),
      propose: (token: string, data: any) => request<any>("/development/competencies/propose", { method: "POST", body: JSON.stringify(data) }, token),
      pending: (token: string) => request<any[]>("/development/competencies/pending", {}, token),
      approve: (token: string, id: string, note?: string) => request<any>(`/development/competencies/${id}/approve`, { method: "POST", body: JSON.stringify({ note }) }, token),
      reject: (token: string, id: string, note: string) => request<any>(`/development/competencies/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }, token),
      seedDefaults: (token: string) => request<any>("/development/competencies/seed-defaults", { method: "POST" }, token),
    },
    roleCompetencies: {
      list: (token: string, position?: string) =>
        request<any[]>(`/development/role-competencies${position ? `?position=${encodeURIComponent(position)}` : ''}`, {}, token),
      create: (token: string, data: { position: string; competencyId: string; expectedLevel: number }) =>
        request<any>("/development/role-competencies", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: { expectedLevel: number }) =>
        request<any>(`/development/role-competencies/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      remove: (token: string, id: string) =>
        request<void>(`/development/role-competencies/${id}`, { method: "DELETE" }, token),
      bulkAssign: (token: string, data: { position: string; defaultLevel?: number }) =>
        request<{ created: number }>("/development/role-competencies/bulk", { method: "POST", body: JSON.stringify(data) }, token),
    },
    plans: {
      list: (token: string) => request<any[]>("/development/plans", {}, token),
      getById: (token: string, id: string) => request<any>(`/development/plans/${id}`, {}, token),
      create: (token: string, data: any) => request<any>("/development/plans", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/development/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      activate: (token: string, id: string) => request<any>(`/development/plans/${id}/activate`, { method: "POST" }, token),
      complete: (token: string, id: string) => request<any>(`/development/plans/${id}/complete`, { method: "POST" }, token),
      /** Planes activos sin acciones cargadas (alerta del CommandCenter admin). */
      withoutActions: (token: string) =>
        request<{ count: number; samples: Array<{ id: string; title: string; userId: string }> }>(
          '/development/plans/without-actions', {}, token,
        ),
    },
    actions: {
      create: (token: string, planId: string, data: any) => request<any>(`/development/plans/${planId}/actions`, { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/development/actions/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      complete: (token: string, id: string) => request<any>(`/development/actions/${id}/complete`, { method: "POST" }, token),
      remove: (token: string, id: string) => request<void>(`/development/actions/${id}`, { method: "DELETE" }, token),
    },
    comments: {
      list: (token: string, planId: string) => request<any[]>(`/development/plans/${planId}/comments`, {}, token),
      create: (token: string, planId: string, data: any) => request<any>(`/development/plans/${planId}/comments`, { method: "POST", body: JSON.stringify(data) }, token),
      remove: (token: string, planId: string, commentId: string) => request<void>(`/development/plans/${planId}/comments/${commentId}`, { method: "DELETE" }, token),
    },
    suggest: (token: string, userId: string, cycleId: string) => request<any>(`/development/suggest/${userId}/${cycleId}`, {}, token),
  },

  orgDevelopment: {
    plans: {
      list: (token: string) => request<any[]>("/org-development/plans", {}, token),
      create: (token: string, data: any) => request<any>("/org-development/plans", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/org-development/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      delete: (token: string, id: string) => request<void>(`/org-development/plans/${id}`, { method: "DELETE" }, token),
    },
    initiatives: {
      listByPlan: (token: string, planId: string) => request<any[]>(`/org-development/plans/${planId}/initiatives`, {}, token),
      create: (token: string, planId: string, data: any) => request<any>(`/org-development/plans/${planId}/initiatives`, { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/org-development/initiatives/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      delete: (token: string, id: string) => request<void>(`/org-development/initiatives/${id}`, { method: "DELETE" }, token),
      linkedPdis: (token: string, id: string) => request<any[]>(`/org-development/initiatives/${id}/pdis`, {}, token),
    },
    actions: {
      create: (token: string, initiativeId: string, data: any) => request<any>(`/org-development/initiatives/${initiativeId}/actions`, { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/org-development/actions/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      delete: (token: string, id: string) => request<void>(`/org-development/actions/${id}`, { method: "DELETE" }, token),
    },
    activeInitiatives: (token: string, dept?: string) => {
      const qs = dept ? `?dept=${encodeURIComponent(dept)}` : '';
      return request<any[]>(`/org-development/active-initiatives${qs}`, {}, token);
    },
  },

  health: {
    check: () => request<{ status: string }>("/"),
  },

  ai: {
    getSummary: (token: string, cycleId: string, userId: string) =>
      request<any>(`/ai/summary/${userId}/${cycleId}`, {}, token),
    generateSummary: (token: string, cycleId: string, userId: string) =>
      request<any>(`/ai/summary/${userId}/${cycleId}`, { method: "POST" }, token),
    getBias: (token: string, cycleId: string) =>
      request<any>(`/ai/bias/${cycleId}`, {}, token),
    analyzeBias: (token: string, cycleId: string) =>
      request<any>(`/ai/bias/${cycleId}`, { method: "POST" }, token),
    getSuggestions: (token: string, cycleId: string, userId: string) =>
      request<any>(`/ai/suggestions/${userId}/${cycleId}`, {}, token),
    generateSuggestions: (token: string, cycleId: string, userId: string) =>
      request<any>(`/ai/suggestions/${userId}/${cycleId}`, { method: "POST" }, token),
    getFlightRisk: (token: string) =>
      request<any>(`/ai/flight-risk`, {}, token),
    getUsage: (token: string) => request<any>('/ai/usage', {}, token),
    getTenantUsage: (token: string) => request<any>('/ai/tenant-usage', {}, token),
    /** POST /ai/cycle-comparison — IA-driven análisis comparativo entre
     *  ciclos seleccionados. Difiere del endpoint reports/.../cycle-comparison
     *  (que es solo numerico). */
    analyzeCycleComparison: (token: string, cycleIds: string[]) =>
      request<any>('/ai/cycle-comparison', {
        method: 'POST',
        body: JSON.stringify({ cycleIds }),
      }, token),
    exportSummaryPdf: (token: string, cycleId: string, userId: string) =>
      `${BASE_URL}/ai/summary-pdf/${userId}/${cycleId}`,
    getPerformancePrediction: (token: string, userId: string) =>
      request<any>(`/ai/prediction/${userId}`, {}, token),
    getRetentionRecommendations: (token: string) =>
      request<any>(`/ai/retention`, {}, token),
    getExplainability: (token: string, userId: string) =>
      request<any>(`/ai/explainability/${userId}`, {}, token),
  },

  system: {
    changelog: (token: string, limit = 5) =>
      request<any[]>(`/system/changelog?limit=${limit}`, {}, token),
    allChangelog: (token: string) =>
      request<any[]>("/system/changelog/all", {}, token),
    createChangelog: (token: string, data: any) =>
      request<any>("/system/changelog", { method: "POST", body: JSON.stringify(data) }, token),
    updateChangelog: (token: string, id: string, data: any) =>
      request<any>(`/system/changelog/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    deleteChangelog: (token: string, id: string) =>
      request<void>(`/system/changelog/${id}`, { method: "DELETE" }, token),
  },

  dei: {
    demographics: (token: string) => request<any>("/dei/demographics", {}, token),
    equity: (token: string, cycleId: string) => request<any>(`/dei/equity?cycleId=${cycleId}`, {}, token),
    gapReport: (token: string, cycleId: string, dimension = 'gender') =>
      request<any>(`/dei/gap-report?cycleId=${cycleId}&dimension=${dimension}`, {}, token),
    getConfig: (token: string) => request<any>("/dei/config", {}, token),
    updateConfig: (token: string, config: Record<string, any>) =>
      request<any>("/dei/config", { method: "PATCH", body: JSON.stringify(config) }, token),
    listCorrectiveActions: (token: string) => request<any[]>("/dei/corrective-actions", {}, token),
    createCorrectiveAction: (token: string, data: any) =>
      request<any>("/dei/corrective-actions", { method: "POST", body: JSON.stringify(data) }, token),
    updateCorrectiveAction: (token: string, id: string, data: any) =>
      request<any>(`/dei/corrective-actions/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
  },

  /** Uploads — multipart/form-data. El wrapper detecta FormData y skipea
   *  Content-Type para que el navegador setee el boundary correctamente. */
  uploads: {
    create: (token: string, formData: FormData) =>
      request<{ id: string; url: string; mimeType: string; size: number }>(
        '/uploads',
        { method: 'POST', body: formData },
        token,
      ),
  },

  recognition: {
    wall: (
      token: string,
      page = 1,
      limit = 20,
      filters?: {
        search?: string;
        dateFrom?: string;
        dateTo?: string;
        valueId?: string;
        departmentId?: string;
        scope?: 'all' | 'received' | 'sent' | 'mine';
      },
    ) => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (filters?.search) params.set('search', filters.search);
      if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters?.dateTo) params.set('dateTo', filters.dateTo);
      if (filters?.valueId) params.set('valueId', filters.valueId);
      if (filters?.departmentId) params.set('departmentId', filters.departmentId);
      if (filters?.scope && filters.scope !== 'all') params.set('scope', filters.scope);
      return request<any>(`/recognition/wall?${params.toString()}`, {}, token);
    },
    create: (token: string, data: { toUserId: string; message: string; valueId?: string; points?: number }) =>
      request<any>("/recognition", { method: "POST", body: JSON.stringify(data) }, token),
    addReaction: (token: string, id: string, emoji: string) =>
      request<any>(`/recognition/${id}/reaction`, { method: "POST", body: JSON.stringify({ emoji }) }, token),
    badges: (token: string) => request<any[]>("/recognition/badges", {}, token),
    createBadge: (token: string, data: any) =>
      request<any>("/recognition/badges", { method: "POST", body: JSON.stringify(data) }, token),
    myBadges: (token: string) => request<any[]>("/recognition/badges/mine", {}, token),
    userBadges: (token: string, userId: string) => request<any[]>(`/recognition/badges/user/${userId}`, {}, token),
    awardBadge: (token: string, data: { userId: string; badgeId: string }) =>
      request<any>("/recognition/badges/award", { method: "POST", body: JSON.stringify(data) }, token),
    myPoints: (token: string) => request<any>("/recognition/points/mine", {}, token),
    leaderboard: (token: string, period = 'year', limit = 20) =>
      request<any[]>(`/recognition/leaderboard?period=${period}&limit=${limit}`, {}, token),
    leaderboardHistorical: (token: string) =>
      request<any[]>("/recognition/leaderboard/historical", {}, token),
    stats: (token: string) => request<any>("/recognition/stats", {}, token),
    budget: (token: string) => request<any>("/recognition/budget/mine", {}, token),
    pendingApprovals: (token: string) => request<any[]>("/recognition/approvals/pending", {}, token),
    approve: (token: string, id: string, approved: boolean) =>
      request<any>(`/recognition/${id}/approve`, { method: "POST", body: JSON.stringify({ approved }) }, token),
    catalog: (token: string) => request<any[]>("/recognition/catalog", {}, token),
    createCatalogItem: (token: string, data: any) =>
      request<any>("/recognition/catalog", { method: "POST", body: JSON.stringify(data) }, token),
    updateCatalogItem: (token: string, id: string, data: any) =>
      request<any>(`/recognition/catalog/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    redeem: (token: string, itemId: string) =>
      request<any>(`/recognition/redeem/${itemId}`, { method: "POST" }, token),
    myRedemptions: (token: string) => request<any[]>("/recognition/redemptions/mine", {}, token),
    challenges: (token: string) => request<any[]>("/recognition/challenges", {}, token),
    myChallenges: (token: string) => request<any[]>("/recognition/challenges/mine", {}, token),
    createChallenge: (token: string, data: any) =>
      request<any>("/recognition/challenges", { method: "POST", body: JSON.stringify(data) }, token),
    updateChallenge: (token: string, id: string, data: any) =>
      request<any>(`/recognition/challenges/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    challengeParticipants: (token: string, id: string) =>
      request<any[]>(`/recognition/challenges/${id}/participants`, {}, token),
    itemRedemptions: (token: string, id: string) =>
      request<any[]>(`/recognition/catalog/${id}/redemptions`, {}, token),
    updateRedemptionStatus: (token: string, id: string, status: string) =>
      request<any>(`/recognition/redemptions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }, token),
    leaderboardOptIn: (token: string, period = 'month', limit = 20, department?: string) =>
      request<any[]>(`/recognition/leaderboard-optin?period=${period}&limit=${limit}${department ? `&department=${department}` : ''}`, {}, token),
    toggleOptIn: (token: string, optIn: boolean) =>
      request<any>("/recognition/leaderboard-optin/toggle", { method: "POST", body: JSON.stringify({ optIn }) }, token),
    // ─── v3.1 F7 — Comentarios + MVP del Mes ────────────────────────
    listComments: (token: string, id: string) =>
      request<Array<{
        id: string; recognitionId: string; fromUserId: string;
        text: string; createdAt: string;
        fromUser?: { firstName: string; lastName: string };
      }>>(`/recognition/${id}/comments`, {}, token),
    addComment: (token: string, id: string, text: string) =>
      request<any>(`/recognition/${id}/comments`, {
        method: 'POST', body: JSON.stringify({ text }),
      }, token),
    deleteComment: (token: string, commentId: string) =>
      request<{ deleted: true }>(`/recognition/comments/${commentId}`, { method: 'DELETE' }, token),
    currentMvp: (token: string) =>
      request<{
        id: string; month: string; userId: string;
        totalKudosCount: number; uniqueGiversCount: number;
        valuesTouched: string[];
        user?: { firstName: string; lastName: string; position?: string; department?: string };
      } | null>('/recognition/mvp/current', {}, token),
    mvpHistory: (token: string, limit = 12) =>
      request<Array<{
        id: string; month: string; userId: string;
        totalKudosCount: number; uniqueGiversCount: number;
        user?: { firstName: string; lastName: string };
      }>>(`/recognition/mvp/history?limit=${limit}`, {}, token),
  },

  surveys: {
    list: (token: string) => request<any[]>("/surveys", {}, token),
    findById: (token: string, id: string) => request<any>(`/surveys/${id}`, {}, token),
    /** Encuestas activas próximas a cerrar con < 50% participación */
    lowParticipation: (token: string) =>
      request<Array<{ id: string; title: string; endDate: string | null; daysLeft: number | null; participationPct: number; respondents: number; assigned: number }>>(
        '/surveys/low-participation', {}, token,
      ),
    create: (token: string, dto: any) =>
      request<any>("/surveys", { method: "POST", body: JSON.stringify(dto) }, token),
    update: (token: string, id: string, dto: any) =>
      request<any>(`/surveys/${id}`, { method: "PATCH", body: JSON.stringify(dto) }, token),
    delete: (token: string, id: string) =>
      request<void>(`/surveys/${id}`, { method: "DELETE" }, token),
    launch: (token: string, id: string) =>
      request<any>(`/surveys/${id}/launch`, { method: "POST" }, token),
    close: (token: string, id: string) =>
      request<any>(`/surveys/${id}/close`, { method: "POST" }, token),
    respond: (token: string, id: string, answers: any[]) =>
      request<any>(`/surveys/${id}/respond`, { method: "POST", body: JSON.stringify({ answers }) }, token),
    getMyPending: (token: string) => request<any[]>("/surveys/pending", {}, token),
    getResults: (token: string, id: string) => request<any>(`/surveys/${id}/results`, {}, token),
    getResultsByDept: (token: string, id: string) =>
      request<any[]>(`/surveys/${id}/results/department`, {}, token),
    getENPS: (token: string, id: string) => request<any>(`/surveys/${id}/results/enps`, {}, token),
    getTrends: (token: string) => request<any[]>("/surveys/trends", {}, token),
    generateAiAnalysis: (token: string, id: string, force = false) =>
      request<any>(`/surveys/${id}/ai-analysis`, { method: "POST", body: JSON.stringify({ force }) }, token),
    getAiAnalysis: (token: string, id: string) =>
      request<any>(`/surveys/${id}/ai-analysis`, {}, token),
    createInitiatives: (token: string, id: string, targetPlanId?: string) =>
      request<any>(`/surveys/${id}/create-initiatives`, {
        method: "POST",
        body: JSON.stringify({ targetPlanId }),
      }, token),
  },

  signatures: {
    request: (token: string, documentType: string, documentId: string) =>
      request<any>("/signatures/request", { method: "POST", body: JSON.stringify({ documentType, documentId }) }, token),
    verify: (token: string, documentType: string, documentId: string, code: string) =>
      request<any>("/signatures/verify", { method: "POST", body: JSON.stringify({ documentType, documentId, code }) }, token),
    list: (token: string, documentType: string, documentId: string) =>
      request<any[]>(`/signatures/document/${documentType}/${documentId}`, {}, token),
    listAll: (token: string) => request<any[]>("/signatures", {}, token),
    mine: (token: string) => request<any[]>("/signatures/mine", {}, token),
    team: (token: string) => request<any[]>("/signatures/team", {}, token),
    verifyIntegrity: (token: string, id: string) =>
      request<any>(`/signatures/verify/${id}`, {}, token),
  },

  contracts: {
    list: (token: string) => request<any[]>("/contracts", {}, token),
    getById: (token: string, id: string) => request<any>(`/contracts/${id}`, {}, token),
    create: (token: string, data: any) => request<any>("/contracts", { method: "POST", body: JSON.stringify(data) }, token),
    update: (token: string, id: string, data: any) => request<any>(`/contracts/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    sendForSignature: (token: string, id: string) => request<any>(`/contracts/${id}/send`, { method: "POST" }, token),
    getTypes: (token: string) => request<any[]>("/contracts/types", {}, token),
    getTemplates: (token: string) => request<any[]>("/contracts/templates", {}, token),
    bulkCreate: (token: string, tenantId: string) => request<any>(`/contracts/bulk-create/${tenantId}`, { method: "POST" }, token),
    remove: (token: string, id: string) => request<void>(`/contracts/${id}`, { method: "DELETE" }, token),
    reject: (token: string, id: string, reason: string) =>
      request<any>(`/contracts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, token),
    submitQuery: (token: string, id: string, data: { type: string; message: string }) =>
      request<{ sent: boolean }>(`/contracts/${id}/query`, { method: "POST", body: JSON.stringify(data) }, token),
    downloadPdfUrl: (token: string, id: string) =>
      `${BASE_URL}/contracts/${id}/pdf`,
    listByTenant: (token: string, tenantId: string) =>
      request<any[]>(`/contracts?tenantId=${tenantId}`, {}, token),
  },

  invoices: {
    list: (token: string, filters?: { status?: string; tenantId?: string; period?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.tenantId) params.set('tenantId', filters.tenantId);
      if (filters?.period) params.set('period', filters.period);
      const qs = params.toString();
      return request<any[]>(`/invoices${qs ? `?${qs}` : ''}`, {}, token);
    },
    /** Invoices of the current tenant — tenant_admin only. Used by the
     *  "Pagar facturas pendientes" section on /mi-suscripcion. */
    my: (token: string) => request<any[]>('/invoices/my', {}, token),
    stats: (token: string) => request<any>("/invoices/stats", {}, token),
    generate: (token: string, subscriptionId: string) =>
      request<any>(`/invoices/generate/${subscriptionId}`, { method: "POST" }, token),
    generateBulk: (token: string) =>
      request<any>("/invoices/generate-bulk", { method: "POST" }, token),
    markAsPaid: (token: string, id: string, data: { paymentMethod?: string; transactionRef?: string; notes?: string }) =>
      request<any>(`/invoices/${id}/pay`, { method: "PATCH", body: JSON.stringify(data) }, token),
    send: (token: string, id: string) =>
      request<any>(`/invoices/${id}/send`, { method: "POST" }, token),
    sendReminders: (token: string) =>
      request<any>("/invoices/send-reminders", { method: "POST" }, token),
    cancel: (token: string, id: string) =>
      request<any>(`/invoices/${id}/cancel`, { method: "PATCH" }, token),
    pdfUrl: (id: string) => `${BASE_URL}/invoices/${id}/pdf`,
  },

  // ─── Impersonation (super_admin) ───────────────────────────────────────
  impersonation: {
    /** Start an impersonation session. Caller must be super_admin.
     *  Returns a new JWT the UI should swap into the auth store. */
    start: (
      token: string,
      dto: { tenantId: string; reason: string; targetUserId?: string },
    ) =>
      request<{
        access_token: string;
        expiresAt: string;
        targetUser: {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
          role: string;
        };
        tenant: { id: string; name: string };
      }>(
        '/support/impersonate',
        { method: 'POST', body: JSON.stringify(dto) },
        token,
      ),
    /** End an impersonation session. Must be called with the
     *  impersonation JWT; returns the original super_admin's token. */
    end: (token: string) =>
      request<{ access_token: string }>(
        '/support/impersonate/end',
        { method: 'POST' },
        token,
      ),
  },

  // ─── SSO ───────────────────────────────────────────────────────────────
  sso: {
    /** Tenant admin: fetch current OIDC config (clientSecret is redacted). */
    getConfig: (token: string) =>
      request<{
        hasSecret: boolean;
        issuerUrl?: string;
        clientId?: string;
        enabled?: boolean;
        requireSso?: boolean;
        allowedEmailDomains?: string[];
        roleMapping?: Record<string, string[]>;
      }>('/auth/sso/config', {}, token),
    /** Tenant admin: create/update OIDC config. Backend validates the issuer.
     *  `clientSecret` is optional on edit — omitted means "keep stored". */
    upsertConfig: (
      token: string,
      dto: {
        issuerUrl: string;
        clientId: string;
        clientSecret?: string;
        enabled?: boolean;
        requireSso?: boolean;
        allowedEmailDomains?: string[];
        roleMapping?: Record<string, string[]>;
      },
    ) =>
      request<{ success: boolean }>(
        '/auth/sso/config',
        { method: 'POST', body: JSON.stringify(dto) },
        token,
      ),
    /** Tenant admin: disable SSO without deleting config. */
    disable: (token: string) =>
      request<{ success: boolean }>('/auth/sso/config', { method: 'DELETE' }, token),
    /** Public: returns SSO URL for the given email's domain, if enabled. */
    discover: (email: string, tenantSlug?: string) =>
      request<{ ssoEnabled: boolean; ssoLoginUrl?: string; tenantName?: string }>(
        '/auth/sso/discover',
        { method: 'POST', body: JSON.stringify({ email, tenantSlug }) },
      ),
  },

  // ─── Auth policy (authenticated) ───────────────────────────────────────
  passwordPolicy: {
    /** Active password policy for the current tenant (authenticated). */
    current: (token: string) =>
      request<{
        minLength: number;
        requireUppercase: boolean;
        requireLowercase: boolean;
        requireNumber: boolean;
        requireSymbol: boolean;
        expiryDays: number | null;
        historyCount: number;
        lockoutThreshold: number;
        lockoutDurationMinutes: number;
      }>('/auth/password-policy', {}, token),
    /** Same, but unauthenticated — keyed by email. Used by /login force-change
     *  modal to show the right rules before the user has a session. Does
     *  not reveal whether the email exists. */
    byEmail: (email: string, tenantSlug?: string) => {
      const params = new URLSearchParams({ email });
      if (tenantSlug) params.set('tenantSlug', tenantSlug);
      return request<{
        minLength: number;
        requireUppercase: boolean;
        requireLowercase: boolean;
        requireNumber: boolean;
        requireSymbol: boolean;
        expiryDays: number | null;
        historyCount: number;
        lockoutThreshold: number;
        lockoutDurationMinutes: number;
      }>(`/auth/password-policy/public?${params.toString()}`);
    },
  },

  // ─── Payments (authenticated) ──────────────────────────────────────────
  payments: {
    /** Providers enabled in this deployment. Used by PayInvoiceModal to
     *  only show the options that actually work. */
    listProviders: (token: string) =>
      request<Array<{ name: 'stripe' | 'mercadopago'; enabled: boolean }>>(
        '/payments/providers',
        {},
        token,
      ),
    /** Start a checkout. Returns a URL the browser should redirect to. */
    createCheckout: (
      token: string,
      invoiceId: string,
      provider: 'stripe' | 'mercadopago',
    ) =>
      request<{ sessionId: string; checkoutUrl: string; provider: string }>(
        '/payments/checkout',
        { method: 'POST', body: JSON.stringify({ invoiceId, provider }) },
        token,
      ),
    /** Poll after redirect to see if the webhook has landed. */
    getSession: (token: string, sessionId: string) =>
      request<{
        id: string;
        provider: 'stripe' | 'mercadopago';
        status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';
        failureReason: string | null;
        amount: string;
        currency: string;
        invoiceId: string;
        completedAt: string | null;
      }>(`/payments/sessions/${sessionId}`, {}, token),
  },

  // ─── GDPR (authenticated) ──────────────────────────────────────────────
  gdpr: {
    exportMyData: (token: string) =>
      request<{ requestId: string; status: string; estimatedMinutes: number }>(
        "/gdpr/export-my-data",
        { method: "POST" },
        token,
      ),
    requestDelete: (token: string) =>
      request<{ requestId: string; expiresInMinutes: number }>(
        "/gdpr/delete-my-account",
        { method: "POST" },
        token,
      ),
    confirmDelete: (token: string, requestId: string, code: string) =>
      request<{ success: boolean }>(
        "/gdpr/delete-my-account/confirm",
        { method: "POST", body: JSON.stringify({ requestId, code }) },
        token,
      ),
    myRequests: (token: string) =>
      request<Array<{
        id: string;
        type: string;
        status: string;
        fileUrl: string | null;
        fileExpiresAt: string | null;
        errorMessage: string | null;
        metadata: Record<string, unknown>;
        requestedAt: string;
        completedAt: string | null;
      }>>("/gdpr/my-requests", {}, token),
    exportTenantData: (token: string, anonymize?: boolean) =>
      request<{ requestId: string; status: string; estimatedMinutes: number }>(
        `/gdpr/export-tenant-data${anonymize ? "?anonymize=true" : ""}`,
        { method: "POST" },
        token,
      ),
    tenantRequests: (token: string) =>
      request<Array<{
        id: string;
        userId: string;
        type: string;
        status: string;
        fileExpiresAt: string | null;
        errorMessage: string | null;
        metadata: Record<string, unknown>;
        requestedAt: string;
        completedAt: string | null;
      }>>("/gdpr/tenant-requests", {}, token),
  },

  // ─── Public unsubscribe (NO auth) ──────────────────────────────────────
  // Invoked from /unsubscribe?token=xxx. Token is an HMAC-signed payload
  // embedded in transactional emails; no Authorization header is sent.
  publicUnsubscribe: {
    validate: (token: string) =>
      request<{
        email: string;
        firstName: string;
        orgName: string;
        preferences: Record<string, boolean>;
      }>("/public/unsubscribe/validate", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    update: (token: string, preferences: Record<string, boolean>) =>
      request<{ success: boolean }>("/public/unsubscribe/update", {
        method: "POST",
        body: JSON.stringify({ token, preferences }),
      }),
    unsubscribeAll: (token: string) =>
      request<{ success: boolean }>("/public/unsubscribe/all", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
  },

  // ─── Leads (super_admin — pipeline pre-venta) ──────────────────────────
  leads: {
    getStats: (token: string) =>
      request<{
        new: number;
        contacted: number;
        qualified: number;
        converted: number;
        discarded: number;
        total: number;
      }>("/leads/stats", {}, token),

    list: (token: string, filters?: { status?: string; origin?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.origin) params.set("origin", filters.origin);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return request<
        Array<{
          id: string;
          name: string;
          company: string;
          role: string | null;
          email: string;
          phone: string;
          companySize: string | null;
          industry: string | null;
          region: string | null;
          source: string | null;
          message: string;
          origin: string;
          ipAddress: string | null;
          captchaVerdict: string;
          status: "new" | "contacted" | "qualified" | "converted" | "discarded";
          internalNotes: string | null;
          assignedTo: string | null;
          assignee: { id: string; firstName: string; lastName: string } | null;
          statusChangedAt: string | null;
          convertedTenantId: string | null;
          createdAt: string;
          updatedAt: string;
        }>
      >(`/leads${qs}`, {}, token);
    },

    get: (token: string, id: string) =>
      request<any>(`/leads/${id}`, {}, token),

    update: (
      token: string,
      id: string,
      dto: {
        status?: "new" | "contacted" | "qualified" | "converted" | "discarded";
        internalNotes?: string;
        assignedTo?: string | null;
        convertedTenantId?: string | null;
      },
    ) =>
      request<any>(
        `/leads/${id}`,
        { method: "PATCH", body: JSON.stringify(dto) },
        token,
      ),

    remove: (token: string, id: string) =>
      request<void>(`/leads/${id}`, { method: "DELETE" }, token),
  },

  // ─── Push Notifications (v3.0) ────────────────────────────────────────
  push: {
    getVapidKey: (token: string) =>
      request<{ publicKey: string }>("/notifications/push/vapid-key", {}, token),

    subscribe: (
      token: string,
      dto: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
        userAgent?: string;
      },
    ) =>
      request<{ id: string; createdAt: string; lastUsedAt: string }>(
        "/notifications/push/subscribe",
        { method: "POST", body: JSON.stringify(dto) },
        token,
      ),

    unsubscribe: (token: string, endpoint: string) =>
      request<void>(
        `/notifications/push/unsubscribe?endpoint=${encodeURIComponent(endpoint)}`,
        { method: "DELETE" },
        token,
      ),

    listDevices: (token: string) =>
      request<
        Array<{
          id: string;
          userAgent: string | null;
          createdAt: string;
          lastUsedAt: string | null;
        }>
      >("/notifications/push/devices", {}, token),

    test: (token: string) =>
      request<{ sent: number; failed: number; skipped: number }>(
        "/notifications/push/test",
        { method: "POST" },
        token,
      ),

    metrics: (token: string) =>
      request<{
        total: number;
        activeLast7d: number;
        failuresLast7d: number;
        byBrowser: Record<string, number>;
      }>("/notifications/push/metrics", {}, token),
  },
};
