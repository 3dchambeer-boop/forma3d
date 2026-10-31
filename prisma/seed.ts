// =====================================================================
// FORMA·3D database seed — creates ACCOUNTS AND CONFIGURATION ONLY.
//
// The previous seed filled the database with invented projects, print jobs,
// telemetry and "passed:manifold" reports for STL files that are not valid
// solids. Those rows made dashboards and analytics show fabricated numbers,
// so they are gone. Everything here is idempotent (upserts) and nothing is
// ever deleted.
//
// Required:
//   SEED_ORG_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (≥ 12 chars)
// Optional, refused when NODE_ENV=production:
//   SEED_DEMO_USERS=1 + SEED_DEMO_PASSWORD (≥ 12 chars) → one user per role
//   for local testing (designer@, farm@, user@ on the admin's e-mail domain).
// Optional printer (real hardware):
//   SEED_PRINTER_NAME, SEED_PRINTER_MODEL, SEED_PRINTER_OCTOPRINT_URL,
//   SEED_PRINTER_KEY_ENV (NAME of the env var that holds its API key),
//   SEED_PRINTER_BUILD_VOLUME="220x220x250", SEED_PRINTER_MATERIALS="PLA,PETG"
//
// Run: bun prisma/seed.ts
// =====================================================================

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function strongPassword(name: string): string {
  const v = need(name);
  if (v.length < 12) throw new Error(`${name} must be at least 12 characters`);
  return v;
}

async function upsertUser(email: string, name: string, role: Role, password: string, orgId: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role, passwordHash },
    create: { email, name, role, passwordHash },
  });
  await prisma.organizationMembership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
    update: { role },
    create: { userId: user.id, organizationId: orgId, role },
  });
  console.log(`[seed] ${role.padEnd(12)} ${email}`);
}

async function main() {
  const orgName = need('SEED_ORG_NAME');
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'org';
  const org = await prisma.organization.upsert({ where: { slug }, update: { name: orgName }, create: { name: orgName, slug } });

  const adminEmail = need('SEED_ADMIN_EMAIL').toLowerCase();
  await upsertUser(adminEmail, 'Administrator', Role.ADMIN, strongPassword('SEED_ADMIN_PASSWORD'), org.id);

  if (process.env.SEED_DEMO_USERS === '1') {
    if (process.env.NODE_ENV === 'production') throw new Error('SEED_DEMO_USERS is refused in production');
    const pw = strongPassword('SEED_DEMO_PASSWORD');
    const domain = adminEmail.split('@')[1];
    await upsertUser(`user@${domain}`, 'Test End User', Role.END_USER, pw, org.id);
    await upsertUser(`designer@${domain}`, 'Test Designer', Role.DESIGNER, pw, org.id);
    await upsertUser(`farm@${domain}`, 'Test Farm Manager', Role.FARM_MANAGER, pw, org.id);
  }

  if (process.env.SEED_PRINTER_NAME) {
    const [x, y, z] = (process.env.SEED_PRINTER_BUILD_VOLUME || '220x220x250').split('x').map(Number);
    const keyRef = process.env.SEED_PRINTER_KEY_ENV || null;
    if (keyRef && !/^[A-Z][A-Z0-9_]{2,63}$/.test(keyRef)) throw new Error('SEED_PRINTER_KEY_ENV must be an env var NAME');
    const existing = await prisma.printer.findFirst({ where: { name: process.env.SEED_PRINTER_NAME, organizationId: org.id } });
    const data = {
      name: process.env.SEED_PRINTER_NAME,
      organizationId: org.id,
      model: process.env.SEED_PRINTER_MODEL || 'Creality Ender-3',
      status: 'OFFLINE' as const, // becomes IDLE only after OctoPrint answers
      buildVolumeX: x, buildVolumeY: y, buildVolumeZ: z,
      nozzleDiameter: Number(process.env.SEED_PRINTER_NOZZLE || 0.4),
      materials: process.env.SEED_PRINTER_MATERIALS || 'PLA',
      octoprintUrl: process.env.SEED_PRINTER_OCTOPRINT_URL || null,
      octoprintApiKeyRef: keyRef,
    };
    if (existing) await prisma.printer.update({ where: { id: existing.id }, data });
    else await prisma.printer.create({ data });
    console.log(`[seed] printer ${data.name} (${data.model}) → ${data.octoprintUrl ?? 'no OctoPrint URL'}`);
  }

  // A slicing profile row points at OrcaSlicer preset files exported by the operator
  // (see docs/PRINTING.md). The files are checked at slice time; nothing is assumed.
  const profileName = 'Ender-3 PLA 0.20mm';
  if (!(await prisma.slicingProfile.findFirst({ where: { name: profileName } }))) {
    await prisma.slicingProfile.create({
      data: {
        name: profileName,
        printerModel: 'Creality Ender-3',
        material: 'PLA',
        nozzleDiameter: 0.4,
        layerHeight: 0.2,
        infillDensity: 20,
        printSpeed: 60,
        supportsEnabled: false,
        config: JSON.stringify({ machine: 'ender3-pla-0.20/machine.json', process: 'ender3-pla-0.20/process.json', filament: 'ender3-pla-0.20/filament.json' }),
      },
    });
    console.log(`[seed] slicing profile "${profileName}" (preset files expected under ORCASLICER_PROFILE_DIR)`);
  }
}

main()
  .catch((e) => {
    console.error('[seed] failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
