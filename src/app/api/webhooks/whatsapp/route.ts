// GET: Meta verification handshake. POST: delivery receipts, accepted only with a valid X-Hub-Signature-256.
import { NextRequest } from 'next/server';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';
import { notifications } from '@/lib/server/commerce';
import { parseStatuses, verifyHandshake, verifyMetaSignature } from '@/lib/notify/whatsapp';

export async function GET(req: NextRequest) {
  const challenge = verifyHandshake(new URL(req.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN || '');
  return challenge ? new Response(challenge, { status: 200 }) : new Response('forbidden', { status: 403 });
}
export async function POST(req: NextRequest) {
  const limited = rateLimited(clientIp(req.headers), 'webhook');
  if (limited) return limited;
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET || '')) return new Response('bad signature', { status: 401 });
  let body: unknown; try { body = JSON.parse(raw.toString('utf8')); } catch { return new Response('bad json', { status: 400 }); }
  for (const s of parseStatuses(body)) await notifications.applyReceipt(s);
  return new Response('ok', { status: 200 });
}
