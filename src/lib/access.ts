// =====================================================================
// Resource-level authorization shared by API routes.
// Role checks say what kind of action a user may take; these checks say
// WHICH records they may touch. Both run on the server for every request.
// =====================================================================

import { canReadGcode, canReadModel, type Actor } from './access-rules';
import { db } from './db';

export { canViewProject } from './access-rules';

/**
 * May this user download a stored model file?
 * Farm managers only get files of revisions that were approved for printing.
 */
export async function canReadModelFile(user: Actor, key: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  const urls = [`/api/models/${key}`, `/models/${key}`];
  const rev = await db.designRevision.findFirst({
    where: { OR: [{ modelUrl: { in: urls } }, { stlUrl: { in: urls } }, { sourceModelUrl: { in: urls } }] },
    select: { status: true, project: { select: { ownerId: true } } },
  });
  return canReadModel(user, rev ? { ownerId: rev.project.ownerId, status: rev.status } : null);
}

export async function canReadGcodeFile(user: Actor, key: string): Promise<boolean> {
  if (!canReadGcode(user, true)) return false;
  const job = await db.printJob.findFirst({ where: { gcodeUrl: `/api/gcode/${key}` }, select: { id: true } });
  return canReadGcode(user, !!job);
}
