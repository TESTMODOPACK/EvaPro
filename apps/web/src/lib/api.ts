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
  id: string; name: string; slug: string; plan: string;
  ownerType: string; maxEmployees: number; isActive: boolean; createdAt: string;
}

export interface UserData {
  id: string; tenantId: string; email: string; firstName: string; lastName: string;
  role: string; managerId: string | null; department: string | null;
  position: string | null; hireDate: string | null; isActive: boolean; createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[]; total: number; page: number; limit: number;
}

export interface CycleData {
  id: string; tenantId: string; name: string; type: string; status: string;
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
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? "Error en la solicitud");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── API object ─────────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (email: string, password: string, tenantSlug?: string) =>
      request<AuthTokens>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, tenantSlug }),
      }),
  },

  tenants: {
    list: (token: string) => request<Tenant[]>("/tenants", {}, token),
    create: (data: Partial<Tenant>, token: string) =>
      request<Tenant>("/tenants", { method: "POST", body: JSON.stringify(data) }, token),
  },

  users: {
    list: (token: string, page = 1, limit = 50) =>
      request<PaginatedResponse<UserData>>(`/users?page=${page}&limit=${limit}`, {}, token),
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
  },

  reports: {
    cycleSummary: (token: string, cycleId: string) =>
      request<CycleSummary>(`/reports/cycle/${cycleId}/summary`, {}, token),
    individual: (token: string, cycleId: string, userId: string) =>
      request<any>(`/reports/cycle/${cycleId}/individual/${userId}`, {}, token),
    team: (token: string, cycleId: string, managerId: string) =>
      request<any>(`/reports/cycle/${cycleId}/team/${managerId}`, {}, token),
    exportCsv: (token: string, cycleId: string) =>
      `${BASE_URL}/reports/cycle/${cycleId}/export?format=csv`,
  },

  dashboard: {
    stats: (token: string) =>
      request<DashboardStats>("/dashboard/stats", {}, token),
  },

  health: {
    check: () => request<{ status: string }>("/"),
  },
};
