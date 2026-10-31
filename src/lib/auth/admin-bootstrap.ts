// =====================================================================
// First administrator, created by the operator at deployment — never through the website, never from front-end code.
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… bun scripts/create-admin.ts            (creates the first admin)
//   … bun scripts/create-admin.ts --reset-password                         (resets that admin's password)
// The password comes from the environment of that one command (not from .env in git), must pass the administrator
// password policy, is stored only as a bcrypt hash, and is never printed. If an administrator already exists, the
// command refuses unless --reset-password names that same e-mail; it never demotes or deletes anyone.
// =====================================================================
import { passwordProblems } from './password-policy.ts';

export interface AdminRepo {
  countAdmins(): Promise<number>;
  findByEmail(email: string): Promise<{ id: string; role: string } | null>;
  createAdmin(u: { email: string; name: string; passwordHash: string }): Promise<{ id: string }>;
  promoteAndSetPassword(id: string, passwordHash: string): Promise<void>;
  setPassword(id: string, passwordHash: string): Promise<void>;
  audit(action: string, userId: string, meta: Record<string, unknown>): Promise<void>;
}
export class BootstrapError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'BootstrapError'; } }

export async function bootstrapAdmin(env: Record<string, string | undefined>, repo: AdminRepo, hash: (pw: string) => Promise<string>, o: { resetPassword?: boolean } = {}) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = env.ADMIN_PASSWORD || '';
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new BootstrapError('BAD_EMAIL', 'ADMIN_EMAIL must be an e-mail address');
  const problems = passwordProblems(pw, { admin: true, email });
  if (problems.length) throw new BootstrapError('WEAK_PASSWORD', `ADMIN_PASSWORD needs: ${problems.join('; ')}`);
  const existing = await repo.findByEmail(email), admins = await repo.countAdmins();
  if (o.resetPassword) {
    if (!existing || existing.role !== 'ADMIN') throw new BootstrapError('NOT_ADMIN', 'no administrator with this e-mail; --reset-password only resets an existing administrator');
    await repo.setPassword(existing.id, await hash(pw));
    await repo.audit('ADMIN_PASSWORD_RESET_BOOTSTRAP', existing.id, { via: 'create-admin --reset-password' });
    return { action: 'reset' as const, userId: existing.id };
  }
  if (admins > 0) throw new BootstrapError('ADMIN_EXISTS', 'an administrator already exists; manage further roles from the admin console (or use --reset-password for that account)');
  if (existing) {
    await repo.promoteAndSetPassword(existing.id, await hash(pw));
    await repo.audit('ADMIN_BOOTSTRAP_PROMOTE', existing.id, { via: 'create-admin' });
    return { action: 'promoted' as const, userId: existing.id };
  }
  const u = await repo.createAdmin({ email, name: env.ADMIN_NAME?.trim() || 'Administrator', passwordHash: await hash(pw) });
  await repo.audit('ADMIN_BOOTSTRAP_CREATE', u.id, { via: 'create-admin' });
  return { action: 'created' as const, userId: u.id };
}
