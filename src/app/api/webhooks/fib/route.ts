// FIB status callback {id, status}: unsigned, so it only triggers a status query to FIB.
import { NextRequest } from 'next/server';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';
import { payments } from '@/lib/server/commerce';

export async function POST(req: NextRequest) {
  const limited = rateLimited(clientIp(req.headers), 'webhook');
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try { await payments.fibCallback(body); return new Response('ok', { status: 200 }); }
  catch { return new Response('ignored', { status: 202 }); }
}
