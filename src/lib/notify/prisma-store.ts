// Prisma adapter for NotifyStore. STATUS: IMPLEMENTED_BUT_UNVERIFIED (needs `prisma generate` + a database).
import { db } from '@/lib/db';
import type { Delivery, NotifyStore } from './service';

const toD = (r: any): Delivery => ({ key: r.key, eventId: r.eventId, userId: r.userId, channel: r.channel, type: r.type, title: r.title, body: r.body, link: r.link || undefined, vars: JSON.parse(r.vars || '{}'), status: r.status, attempts: r.attempts, nextAttemptAt: +r.nextAttemptAt, providerId: r.providerId || undefined, lastError: r.lastError || undefined, createdAt: +r.createdAt, updatedAt: +r.updatedAt });

export const prismaNotifyStore: NotifyStore = {
  async recipient(id) {
    const u = await db.user.findUnique({ where: { id }, select: { id: true, locale: true, email: true, emailVerified: true, phone: true, phoneVerified: true, status: true } });
    return u && u.status === 'ACTIVE' ? { id: u.id, locale: u.locale === 'EN' ? 'en' : 'ar', email: u.email, emailVerified: u.emailVerified, phone: u.phone, phoneVerified: u.phoneVerified } : null;
  },
  async preferences(userId) {
    const p = await db.notificationPreference.findUnique({ where: { userId } });
    return p ? { channels: { inapp: p.inapp, email: p.email, whatsapp: p.whatsapp }, muted: JSON.parse(p.muted || '[]') } : null;
  },
  async getDelivery(key) { const r = await db.notificationDelivery.findUnique({ where: { key } }); return r ? toD(r) : null; },
  async putDelivery(d) {
    const data = { eventId: d.eventId, userId: d.userId, channel: d.channel, type: d.type, title: d.title, body: d.body, link: d.link || null, vars: JSON.stringify(d.vars), status: d.status, attempts: d.attempts, nextAttemptAt: new Date(d.nextAttemptAt), providerId: d.providerId || null, lastError: d.lastError || null };
    await db.notificationDelivery.upsert({ where: { key: d.key }, create: { key: d.key, ...data }, update: data });
  },
  async due(now, limit) { return (await db.notificationDelivery.findMany({ where: { status: 'queued', nextAttemptAt: { lte: new Date(now) } }, take: limit, orderBy: { nextAttemptAt: 'asc' } })).map(toD); },
  async byProviderId(id) { const r = await db.notificationDelivery.findFirst({ where: { providerId: id } }); return r ? toD(r) : null; },
  async inApp(userId, title, message, link) { await db.notification.create({ data: { userId, type: 'event', title, message, link: link || null } }); },
};
