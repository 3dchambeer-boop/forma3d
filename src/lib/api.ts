// =====================================================================
// FORMA·3D Standardized API Response Helpers
// =====================================================================

import { NextResponse } from 'next/server';

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status }
  );
}

export const apiErrors = {
  unauthorized: () => errorResponse(401, 'UNAUTHORIZED', 'Authentication required'),
  forbidden: (msg = 'Insufficient permissions') => errorResponse(403, 'FORBIDDEN', msg),
  notFound: (resource = 'Resource') => errorResponse(404, 'NOT_FOUND', `${resource} not found`),
  badRequest: (msg: string, details?: unknown) => errorResponse(400, 'BAD_REQUEST', msg, details),
  conflict: (msg: string) => errorResponse(409, 'CONFLICT', msg),
  unprocessable: (msg: string, details?: unknown) => errorResponse(422, 'UNPROCESSABLE_ENTITY', msg, details),
  tooMany: (msg = 'Too many requests') => errorResponse(429, 'TOO_MANY_REQUESTS', msg),
  internal: (msg = 'Internal server error') => errorResponse(500, 'INTERNAL', msg),
};

// Audit log helper — re-exported from session.ts (single source of truth)
export { logAuditSafe as logAudit } from './session';
