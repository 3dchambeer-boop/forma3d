// ZainCash server notification: {"webhook_token": "<JWT>"}; verified (HS256) and confirmed by an inquiry.
import { NextRequest } from 'next/server';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';
import { payments } from '@/lib/server/commerce';
import { PaymentError } from '@/lib/payments/service';

export async function POST(req: NextRequest) {
  const limited = rateLimited(clientIp(req.headers), 'webhook');
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { webhook_token?: string } | null;
  if (!body || !body.webhook_token) return new Response('bad request', { status: 400 });
  try { await payments.zaincashToken(body.webhook_token, 'webhook'); return new Response('ok', { status: 200 }); }
  catch (e) {
    const code = e instanceof PaymentError ? e.code : 'ERROR';
    return new Response(code, { status: code === 'BAD_SIGNATURE' ? 401 : code === 'NOT_FOUND' ? 404 : code === 'AMOUNT_MISMATCH' ? 200 : 500 });
  }
}
