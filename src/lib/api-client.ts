// =====================================================================
// FORMA·3D Client-side API helpers
// =====================================================================

'use client';

import type {
  User, DesignProject, DesignRevision, AIGenerationJob,
  HumanReview, Printer, PrintJob, SlicingProfile,
  AppNotification, AuditEvent, ServiceStatus,
  DesignSpec, GenerationStatusResponse,
} from './types';

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown };
}

async function request<T>(
  url: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> }
): Promise<T> {
  const res = await fetch(url, {
    method: options?.method || 'GET',
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers ?? {}) },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
    signal: options?.signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as ApiErrorShape;
      msg = err.error?.message || msg;
    } catch { /* ignore */ }
    const error = new Error(msg) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

export interface PrintStatus {
  jobId: string; status: string; progress: number | null; printerState: string | null;
  note?: string; source: 'octoprint' | 'database';
}

// === Auth ===
export const api = {
  signIn: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/signin', { method: 'POST', body: { email, password } }),

  signUp: (body: { name: string; email: string; password: string }) =>
    request<{ user: User }>('/api/auth/signup', { method: 'POST', body }),

  signOut: () => request<{ success: boolean }>('/api/auth/signout', { method: 'POST' }),

  me: () => request<{ user: User }>('/api/auth/me'),

  // === Projects ===
  listProjects: (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.search) q.set('search', params.search);
    return request<{ projects: (DesignProject & { owner: { id: string; name: string; email: string }; revisions: DesignRevision[] })[] }>(
      `/api/projects${q.toString() ? `?${q}` : ''}`
    );
  },

  getProject: (id: string) =>
    request<{ project: DesignProject & { revisions: DesignRevision[]; owner: { id: string; name: string; email: string }; generations: AIGenerationJob[] } }>(
      `/api/projects/${id}`
    ),

  /** Enqueue a generation. `idempotencyKey` must be reused when retrying the same submit. */
  createProject: (body: {
    name: string; description?: string; prompt: string; negativePrompt?: string;
    mode: 'AUTO' | 'PARAMETRIC' | 'AI_DESIGN' | 'FREEFORM'; provider?: 'AI_DESIGNER' | 'TRIPO' | 'MESHY' | 'RODIN' | 'SELF_HOSTED' | 'MOCK';
    designQa?: { question: string; answer: string }[]; designUnderstanding?: string;
    inputType: 'TEXT_TO_3D' | 'IMAGE_TO_3D'; referenceImageBase64?: string;
    template?: string; userFields?: Record<string, number>;
    intendedUse?: 'functional' | 'artistic' | 'prototype'; targetLongestMm?: number;
  }, idempotencyKey: string) => request<{ project: DesignProject; revision: DesignRevision; generationJob: AIGenerationJob; spec: DesignSpec | null; replayed?: boolean }>(
    '/api/projects', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }
  ),

  // === Generation ===
  parseSpec: (body: { prompt: string; userFields?: Record<string, number>; template?: string; intendedUse?: string }) =>
    request<{ spec: DesignSpec }>('/api/generations/spec', { method: 'POST', body }),

  clarifyDesign: (body: { idea: string; qa: { question: string; answer: string }[]; round: number }) =>
    request<{ understanding: string; assumptions: string[]; ready: boolean; round: number; maxRounds: number;
      questions: { id: string; question_ar: string; why_ar?: string; kind: string; unit?: string | null; options_ar?: string[]; suggested?: string }[] }>(
      '/api/designer/clarify', { method: 'POST', body }),

  getGeneration: (jobId: string, signal?: AbortSignal) =>
    request<GenerationStatusResponse>(`/api/generations/${jobId}`, { signal }),

  cancelGeneration: (jobId: string) =>
    request<{ id: string; status: string; providerTaskMayStillRun: boolean }>(`/api/generations/${jobId}/cancel`, { method: 'POST' }),

  // === Reviews ===
  listReviews: (status?: string) => {
    const q = status ? `?status=${status}` : '';
    return request<{ revisions: (DesignRevision & { project: DesignProject & { owner: { id: string; name: string; email: string } }; reviews: HumanReview[] })[] }>(
      `/api/reviews${q}`
    );
  },

  approveReview: (revisionId: string, comments?: string) =>
    request<{ review: HumanReview; revision: DesignRevision }>(
      `/api/reviews/${revisionId}/approve`, { method: 'POST', body: { comments: comments || '' } }
    ),

  rejectReview: (revisionId: string, rejectionReason: string, comments?: string) =>
    request<{ review: HumanReview; revision: DesignRevision }>(
      `/api/reviews/${revisionId}/reject`, { method: 'POST', body: { rejectionReason, comments: comments || '' } }
    ),

  requestChanges: (revisionId: string, comments: string) =>
    request<{ review: HumanReview; revision: DesignRevision }>(
      `/api/reviews/${revisionId}/request-changes`, { method: 'POST', body: { comments } }
    ),

  // === Print Jobs ===
  listPrintJobs: (status?: string) => {
    const q = status ? `?status=${status}` : '';
    return request<{ jobs: PrintJob[] }>(`/api/print-jobs${q}`);
  },

  requestPrint: (revisionId: string) =>
    request<{ job: PrintJob }>('/api/print-jobs', { method: 'POST', body: { revisionId } }),

  sliceJob: (jobId: string, slicingProfileId: string, printerId?: string) =>
    request<{
      jobId: string; status: 'SLICED'; gcodeUrl: string; gcodeSize: number;
      estimatedTimeMin: number | null; materialGrams: number | null; layerCount: number | null;
    }>(`/api/print-jobs/${jobId}/slice`, { method: 'POST', body: { slicingProfileId, printerId } }),

  /** Upload G-code to OctoPrint. Does not start the machine. */
  uploadToPrinter: (jobId: string, printerId: string) =>
    request<{ jobId: string; status: 'AWAITING_PRINT_CONFIRMATION'; printer: string }>(
      `/api/print-jobs/${jobId}/dispatch`, { method: 'POST', body: { printerId } }),

  /** Physically start the print; requires explicit confirmation. */
  startPrint: (jobId: string) =>
    request<{ jobId: string; status: 'PRINTING' }>(`/api/print-jobs/${jobId}/start`, { method: 'POST', body: { confirm: true } }),

  controlPrint: (jobId: string, action: 'cancel' | 'pause' | 'resume') =>
    request<PrintStatus>(`/api/print-jobs/${jobId}/control`, { method: 'POST', body: { action } }),

  printStatus: (jobId: string) => request<PrintStatus>(`/api/print-jobs/${jobId}/status`),

  // === Printers ===
  listPrinters: (status?: string) => {
    const q = status ? `?status=${status}` : '';
    return request<{ printers: Printer[] }>(`/api/printers${q}`);
  },

  // === Slicing profiles ===
  listSlicingProfiles: () => request<{ profiles: SlicingProfile[] }>('/api/slicing-profiles'),

  // === Notifications ===
  listNotifications: (unreadOnly?: boolean) => {
    const q = unreadOnly ? '?unread=true' : '';
    return request<{ notifications: AppNotification[] }>(`/api/notifications${q}`);
  },

  markNotificationRead: (id: string) =>
    request<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' }),

  // === Analytics ===
  getAnalytics: (days?: number) => {
    const q = days ? `?days=${days}` : '';
    return request<{
      summary: {
        totalGenerations: number; totalPrints: number; successfulPrints: number;
        printSuccessRate: number; totalUsers: number;
        generationSuccessRate: number | null; stlReady: number; slicedCount: number; creditsUsed: number;
        validation: Record<'VALIDATED' | 'VALID_WITH_WARNINGS' | 'REPAIR_REQUIRED', number>;
      };
      generationVolume: { date: string; parametric: number; tripo: number; selfHosted: number }[];
      printSuccess: { date: string; success: number; failed: number }[];
      userGrowth: { date: string; users: number }[];
      providerLatency: { provider: string; latency: number; success: number; total: number }[];
      reviewTurnaround: { date: string; hours: number }[];
      printerUtilization: { name: string; utilization: number; model: string }[];
      generatedAt: string;
    }>(`/api/analytics${q}`);
  },

  // === Users ===
  listUsers: () => request<{ users: User[] }>('/api/users'),
  changeUserRole: (userId: string, role: 'END_USER' | 'DESIGNER' | 'FARM_MANAGER' | 'ADMIN') =>
    request<{ user: User }>(`/api/users/${userId}/role`, { method: 'PATCH', body: { role } }),

  // === Audit ===
  listAudit: (action?: string, limit?: number) => {
    const q = new URLSearchParams();
    if (action) q.set('action', action);
    if (limit) q.set('limit', String(limit));
    return request<{ events: AuditEvent[] }>(`/api/audit${q.toString() ? `?${q}` : ''}`);
  },

  // === Health ===
  getHealth: () => request<{ status: string; timestamp: string; services: ServiceStatus[] }>('/api/health'),
};
