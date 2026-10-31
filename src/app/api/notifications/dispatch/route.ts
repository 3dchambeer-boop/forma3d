// POST — sends due notifications (call every minute from a scheduler). Protected by NOTIFY_DISPATCH_TOKEN.
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { notifications } from '@/lib/server/commerce';

export async function POST(req: NextRequest) {
  const want = process.env.NOTIFY_DISPATCH_TOKEN || '', got = req.headers.get('x-dispatch-token') || '';
  if (!want || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return new Response('forbidden', { status: 403 });
  return Response.json(await notifications.dispatch(100));
}
