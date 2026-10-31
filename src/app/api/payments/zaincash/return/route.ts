// Customer returns from ZainCash with ?token=<JWT>. The page shown depends on the VERIFIED state, never on the URL.
import { NextRequest, NextResponse } from 'next/server';
import { payments, publicBase } from '@/lib/server/commerce';

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') || '';
  let state = 'error';
  try { state = (await payments.zaincashToken(token, 'redirect')).status.toLowerCase(); } catch { state = 'error'; }
  return NextResponse.redirect(`${publicBase()}/payments/result?state=${encodeURIComponent(state)}`, 303);
}
