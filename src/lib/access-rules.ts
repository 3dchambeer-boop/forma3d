// Pure authorization rules (no database): the single source of truth used by src/lib/access.ts and the
// API routes, and tested directly in tests/node/security.test.ts. Roles: END_USER, DESIGNER, FARM_MANAGER, ADMIN.
export type Role = 'END_USER' | 'DESIGNER' | 'FARM_MANAGER' | 'ADMIN';
export interface Actor { id: string; role: string }

export const canViewProject = (u: Actor, p: { ownerId: string }) => u.role === 'ADMIN' || u.role === 'DESIGNER' || p.ownerId === u.id;
export const canEditProject = (u: Actor, p: { ownerId: string; status?: string }) => u.role === 'ADMIN' || (p.ownerId === u.id && p.status !== 'ARCHIVED');
export const canReviewDesign = (u: Actor) => u.role === 'DESIGNER' || u.role === 'ADMIN';

/** Model files: owners and designers; farm managers only for revisions approved for printing. */
export function canReadModel(u: Actor, rev: { ownerId: string; status: string } | null): boolean {
  if (u.role === 'ADMIN') return true;
  if (!rev) return false;
  if (rev.ownerId === u.id || u.role === 'DESIGNER') return true;
  return u.role === 'FARM_MANAGER' && rev.status === 'APPROVED';
}
/** G-code exists only for print jobs; only the farm and admins handle it. */
export const canReadGcode = (u: Actor, jobExists: boolean) => jobExists && (u.role === 'ADMIN' || u.role === 'FARM_MANAGER');
export const canOperatePrinter = (u: Actor) => u.role === 'FARM_MANAGER' || u.role === 'ADMIN';
export const canIssueInvoice = (u: Actor) => u.role === 'FARM_MANAGER' || u.role === 'ADMIN';
export const canRecordPayment = (u: Actor) => u.role === 'ADMIN';
export const canSeeInvoice = (u: Actor, inv: { customerId: string }) => u.role === 'ADMIN' || inv.customerId === u.id;
/** Contact details (phone, e-mail) of a customer: the customer and admins only. */
export const canSeeContact = (u: Actor, owner: { id: string }) => u.role === 'ADMIN' || owner.id === u.id;
