// Optimistic concurrency for the server API: GET returns an ETag built from the row's version stamp;
// a mutating request must send it back in If-Match. A stale tag gets 409 CONFLICT with the current tag
// (the brief asks for 409; RFC 9110 would also allow 412), a missing tag gets 428 Precondition Required.
export const etagOf = (updatedAt: Date | number, extra: string | number = '') => `W/"${extra}${extra === '' ? '' : '-'}${+new Date(updatedAt)}"`;

export type Precondition = { ok: true } | { ok: false; status: 409 | 428; code: 'CONFLICT' | 'PRECONDITION_REQUIRED'; current: string };

export function checkIfMatch(ifMatch: string | null | undefined, current: string): Precondition {
  if (!ifMatch) return { ok: false, status: 428, code: 'PRECONDITION_REQUIRED', current };
  const norm = (t: string) => t.trim().replace(/^W\//, '');
  const tags = ifMatch.split(',').map(norm);
  if (tags.includes('*') || tags.includes(norm(current))) return { ok: true };
  return { ok: false, status: 409, code: 'CONFLICT', current };
}
