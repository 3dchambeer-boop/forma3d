// =====================================================================
// SSRF-safe download of provider output files.
//
// Output URLs come from third-party API responses, so they are untrusted:
//   - https only
//   - host must match an allow-listed suffix (configured per provider)
//   - every resolved address must be public (no loopback/private/link-local,
//     which also blocks cloud metadata endpoints such as 169.254.169.254)
//   - redirects are followed manually and re-checked hop by hop
//   - the body is streamed with a hard byte limit
// =====================================================================

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ProviderError } from './errors.ts';

export interface SafeFetchOptions {
  allowedHostSuffixes: string[];
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

/**
 * Local simulators used by integration tests run on 127.0.0.1 over http. They are
 * only trusted when explicitly listed AND the process is not in production.
 */
function trustedTestHosts(): string[] {
  if (process.env.NODE_ENV === 'production') return [];
  return (process.env.SAFE_FETCH_TEST_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
}

export function hostAllowed(host: string, suffixes: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return suffixes.some((s) => {
    const suf = s.toLowerCase().trim().replace(/^\*?\./, '');
    return suf.length > 0 && (h === suf || h.endsWith('.' + suf));
  });
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function checkUrl(raw: string, opts: SafeFetchOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError('UNSAFE_URL', 'output URL is not a valid URL');
  }
  const trusted = trustedTestHosts().includes(url.hostname);
  if (url.protocol !== 'https:' && !trusted) {
    throw new ProviderError('UNSAFE_URL', `refusing non-https output URL (${url.protocol})`);
  }
  if (url.username || url.password) throw new ProviderError('UNSAFE_URL', 'credentials in output URL');
  if (!trusted && !hostAllowed(url.hostname, opts.allowedHostSuffixes)) {
    throw new ProviderError(
      'UNSAFE_URL',
      `output host "${url.hostname}" is not in the allow-list (${opts.allowedHostSuffixes.join(', ') || 'empty'}). ` +
        'If this is the provider\'s legitimate CDN, add it to the provider\'s *_DOWNLOAD_HOSTS setting.',
    );
  }
  if (!trusted) {
    const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
      throw new ProviderError('UNSAFE_URL', `output host "${url.hostname}" resolves to a private address`);
    }
  }
  return url;
}

export async function safeDownload(rawUrl: string, opts: SafeFetchOptions): Promise<Buffer> {
  let current = rawUrl;
  const maxRedirects = opts.maxRedirects ?? 3;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await checkUrl(current, opts);
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
    } catch (e) {
      throw new ProviderError('DOWNLOAD_FAILED', `download failed: ${(e as Error).message}`, true, true);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new ProviderError('DOWNLOAD_FAILED', 'redirect without location');
      current = new URL(loc, url).toString();
      continue;
    }
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      // signed provider links expire (Tripo: minutes) — caller re-polls for a fresh link
      throw new ProviderError('OUTPUT_EXPIRED', `output link returned HTTP ${res.status}`, true, true);
    }
    if (!res.ok || !res.body) {
      throw new ProviderError('DOWNLOAD_FAILED', `download returned HTTP ${res.status}`, res.status >= 500, true);
    }
    const declared = Number(res.headers.get('content-length') || '0');
    if (declared > opts.maxBytes) {
      throw new ProviderError('DOWNLOAD_FAILED', `output is ${declared} bytes, above limit ${opts.maxBytes}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel();
        throw new ProviderError('DOWNLOAD_FAILED', `output exceeds limit ${opts.maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    if (total === 0) throw new ProviderError('DOWNLOAD_FAILED', 'downloaded file is empty', true, true);
    return Buffer.concat(chunks);
  }
  throw new ProviderError('DOWNLOAD_FAILED', 'too many redirects');
}
