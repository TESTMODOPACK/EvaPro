/**
 * Centralised API base URL.
 * NEXT_PUBLIC_API_URL is set at build-time by Netlify env var.
 * Falls back to the production Render URL if not configured.
 */
const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://evaluacion-desempeno-api.onrender.com";

// Log which URL is used (visible in browser console for debugging)
if (typeof window !== "undefined") {
  console.info("[EvaPro] API base URL:", BASE_URL);
}

export interface AuthTokens {
  access_token: string;
}

export interface UserProfile {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  ownerType: string;
  maxEmployees: number;
  isActive: boolean;
  createdAt: string;
}

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

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

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
      request<Tenant>(
        "/tenants",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
        token,
      ),
  },

  health: {
    check: () => request<{ status: string }>("/"),
  },
};
