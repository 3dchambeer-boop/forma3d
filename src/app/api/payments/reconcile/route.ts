// POST — reconcile open payments with the providers (run every few minutes). Protected by NOTIFY_DISPATCH_TOKEN.
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { payments } from '@/lib/server/commerce';

export async function POST(req: NextRequest) {
  const want = process.env.NOTIFY_DISPATCH_TOKEN || '', got = req.headers.get('x-dispatch-token') || '';
  if (!want || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return new Response('forbidden', { status: 403 });
  return Response.json(await payments.reconcile());
}
