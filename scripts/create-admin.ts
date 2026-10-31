// Create the first administrator (or reset its password) at deployment. See src/lib/auth/admin-bootstrap.ts.
//   ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='…' ADMIN_NAME='…' bun scripts/create-admin.ts [--reset-password]
// Run it with the variables set for this one command (not stored in .env or git). The password is never printed.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { bootstrapAdmin, BootstrapError } from '../src/lib/auth/admin-bootstrap.ts';

const db = new PrismaClient();
const slug = process.env.SIGNUP_ORG_SLUG;
try {
  const org = slug ? await db.organization.findUnique({ where: { slug } }) : await db.organization.findFirst();
  const r = await bootstrapAdmin(process.env, {
    countAdmins: () => db.user.count({ where: { role: 'ADMIN' } }),
    findByEmail: (email) => db.user.findUnique({ where: { email }, select: { id: true, role: true } }),
    createAdmin: (u) => db.user.create({ data: { email: u.email, name: u.name, passwordHash: u.passwordHash, role: 'ADMIN', emailVerified: true, ...(org ? { memberships: { create: { organizationId: org.id, role: 'ADMIN' } } } : {}) }, select: { id: true } }),
    promoteAndSetPassword: async (id, passwordHash) => { await db.user.update({ where: { id }, data: { role: 'ADMIN', passwordHash } }); },
    setPassword: async (id, passwordHash) => { await db.user.update({ where: { id }, data: { passwordHash } }); },
    audit: async (action, userId, metadata) => { await db.auditEvent.create({ data: { actorId: userId, action, resourceType: 'User', resourceId: userId, metadata: JSON.stringify(metadata) } }); },
  }, (pw) => bcrypt.hash(pw, 12), { resetPassword: process.argv.includes('--reset-password') });
  console.log(`administrator ${r.action}: ${r.userId}`);
} catch (e) {
  console.error(e instanceof BootstrapError ? `refused (${e.code}): ${e.message}` : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
