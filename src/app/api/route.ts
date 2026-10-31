// =====================================================================
// GET /api — root, redirects to /api/health
// =====================================================================

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'FORMA·3D API',
    version: '2.0.0',
    docs: '/api/health',
    endpoints: [
      'POST /api/auth/signin',
      'POST /api/auth/signout',
      'GET /api/auth/me',
      'GET /api/projects',
      'POST /api/projects',
      'GET /api/projects/[id]',
      'GET /api/reviews',
      'POST /api/reviews/[id]/approve',
      'POST /api/reviews/[id]/reject',
      'POST /api/reviews/[id]/request-changes',
      'GET /api/print-jobs',
      'POST /api/print-jobs/[id]/slice',
      'POST /api/print-jobs/[id]/dispatch',
      'GET /api/printers',
      'GET /api/slicing-profiles',
      'GET /api/notifications',
      'POST /api/notifications/[id]/read',
      'GET /api/analytics',
      'GET /api/users',
      'PATCH /api/users/[id]/role',
      'GET /api/audit',
      'GET /api/health',
    ],
  });
}
