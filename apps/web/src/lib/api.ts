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
}

export interface UserData {
  id: string; tenantId: string; email: string; firstName: string; lastName: string;
  role: string; managerId: string | null; department: string | null;
  position: string | null; hireDate: string | null; isActive: boolean; createdAt: string;
  // Demographic (optional)
  gender?: string | null; birthDate?: string | null; nationality?: string | null;
  seniorityLevel?: string | null; contractType?: string | null; workLocation?: string | null;
}

export interface PaginatedResponse<T> {
  data: T[]; total: number; page: number; limit: number;
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
  averageScore: string | null;
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
  scheduledDate: string; topic: string; notes: string | null;
  actionItems: { text: string; completed: boolean }[];
  status: 'scheduled' | 'completed' | 'cancelled';
  completedAt: string | null; createdAt: string;
  manager?: UserData; employee?: UserData;
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

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    // If 401 Unauthorized, clear stale/demo auth and redirect to login
    // Skip redirect for auth endpoints (login, reset-password) so error messages show inline
    const isAuthEndpoint = path.startsWith("/auth/");
    if (res.status === 401 && typeof window !== "undefined" && !isAuthEndpoint) {
      localStorage.removeItem("evapro-auth");
      window.location.href = "/login";
      throw new Error("Sesión expirada");
    }
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? "Error en la solicitud");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
  },

  tenants: {
    me: (token: string) => request<Tenant>("/tenants/me", {}, token),
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
    // Positions catalog
    getPositionsCatalog: (token: string) =>
      request<{ name: string; level: number }[]>("/tenants/me/positions", {}, token),
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
      populate: (token: string, id: string) =>
        request<any[]>(`/talent/calibration/${id}/populate`, { method: "POST" }, token),
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
    list: (token: string, page = 1, limit = 10, filters?: { search?: string; department?: string; role?: string; position?: string; status?: string }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters?.search) params.set('search', filters.search);
      if (filters?.department) params.set('department', filters.department);
      if (filters?.role) params.set('role', filters.role);
      if (filters?.position) params.set('position', filters.position);
      if (filters?.status) params.set('status', filters.status);
      return request<PaginatedResponse<UserData>>(`/users?${params.toString()}`, {}, token);
    },
    me: (token: string) =>
      request<UserData>("/users/me", {}, token),
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
      request<{ created: number; skipped: number }>(`/evaluation-cycles/${cycleId}/auto-generate`, { method: "POST" }, token),
    suggestPeers: (token: string, cycleId: string, evaluateeId: string) =>
      request<any[]>(`/evaluation-cycles/${cycleId}/suggest-peers/${evaluateeId}`, {}, token),
  },

  feedback: {
    createCheckIn: (token: string, data: any) =>
      request<CheckInData>("/feedback/checkins", { method: "POST", body: JSON.stringify(data) }, token),
    listCheckIns: (token: string) =>
      request<CheckInData[]>("/feedback/checkins", {}, token),
    updateCheckIn: (token: string, id: string, data: any) =>
      request<CheckInData>(`/feedback/checkins/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
    completeCheckIn: (token: string, id: string) =>
      request<CheckInData>(`/feedback/checkins/${id}/complete`, { method: "POST" }, token),
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
    executiveDashboard: (token: string, cycleId?: string) =>
      request<any>(`/reports/executive-dashboard${cycleId ? `?cycleId=${cycleId}` : ''}`, {}, token),
    crossAnalysis: (token: string, cycleIds?: string[], surveyId?: string) => {
      const params = new URLSearchParams();
      if (cycleIds?.length) params.set('cycleIds', cycleIds.join(','));
      if (surveyId) params.set('surveyId', surveyId);
      const qs = params.toString();
      return request<any>(`/reports/cross-analysis${qs ? `?${qs}` : ''}`, {}, token);
    },
    crossAnalysisAvailable: (token: string) =>
      request<{ cycles: any[]; surveys: any[] }>('/reports/cross-analysis/available', {}, token),
    cycleSummary: (token: string, cycleId: string) =>
      request<CycleSummary>(`/reports/cycle/${cycleId}/summary`, {}, token),
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
    },
    plans: {
      list: (token: string) => request<any[]>("/development/plans", {}, token),
      getById: (token: string, id: string) => request<any>(`/development/plans/${id}`, {}, token),
      create: (token: string, data: any) => request<any>("/development/plans", { method: "POST", body: JSON.stringify(data) }, token),
      update: (token: string, id: string, data: any) => request<any>(`/development/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
      activate: (token: string, id: string) => request<any>(`/development/plans/${id}/activate`, { method: "POST" }, token),
      complete: (token: string, id: string) => request<any>(`/development/plans/${id}/complete`, { method: "POST" }, token),
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

  recognition: {
    wall: (token: string, page = 1, limit = 20) =>
      request<any>(`/recognition/wall?page=${page}&limit=${limit}`, {}, token),
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
    leaderboard: (token: string, period = 'month', limit = 20) =>
      request<any[]>(`/recognition/leaderboard?period=${period}&limit=${limit}`, {}, token),
    stats: (token: string) => request<any>("/recognition/stats", {}, token),
    budget: (token: string) => request<any>("/recognition/budget/mine", {}, token),
    pendingApprovals: (token: string) => request<any[]>("/recognition/approvals/pending", {}, token),
    approve: (token: string, id: string, approved: boolean) =>
      request<any>(`/recognition/${id}/approve`, { method: "POST", body: JSON.stringify({ approved }) }, token),
    catalog: (token: string) => request<any[]>("/recognition/catalog", {}, token),
    createCatalogItem: (token: string, data: any) =>
      request<any>("/recognition/catalog", { method: "POST", body: JSON.stringify(data) }, token),
    redeem: (token: string, itemId: string) =>
      request<any>(`/recognition/redeem/${itemId}`, { method: "POST" }, token),
    myRedemptions: (token: string) => request<any[]>("/recognition/redemptions/mine", {}, token),
    challenges: (token: string) => request<any[]>("/recognition/challenges", {}, token),
    myChallenges: (token: string) => request<any[]>("/recognition/challenges/mine", {}, token),
    createChallenge: (token: string, data: any) =>
      request<any>("/recognition/challenges", { method: "POST", body: JSON.stringify(data) }, token),
    leaderboardOptIn: (token: string, period = 'month', limit = 20, department?: string) =>
      request<any[]>(`/recognition/leaderboard-optin?period=${period}&limit=${limit}${department ? `&department=${department}` : ''}`, {}, token),
    toggleOptIn: (token: string, optIn: boolean) =>
      request<any>("/recognition/leaderboard-optin/toggle", { method: "POST", body: JSON.stringify({ optIn }) }, token),
  },

  surveys: {
    list: (token: string) => request<any[]>("/surveys", {}, token),
    findById: (token: string, id: string) => request<any>(`/surveys/${id}`, {}, token),
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
    generateAiAnalysis: (token: string, id: string) =>
      request<any>(`/surveys/${id}/ai-analysis`, { method: "POST" }, token),
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
  },
};
