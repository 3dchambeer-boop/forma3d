// Wiring of the notification and payment services for the Next.js server (singletons from env).
// STATUS: IMPLEMENTED_BUT_UNVERIFIED — the services are tested; this wiring needs the built app + database.
import { EmailClient } from '@/lib/notify/email';
import { prismaNotifyStore } from '@/lib/notify/prisma-store';
import { NotificationService } from '@/lib/notify/service';
import { WhatsAppClient } from '@/lib/notify/whatsapp';
import { FibClient } from '@/lib/payments/fib';
import { prismaPaymentStore } from '@/lib/payments/prisma-store';
import { PaymentService } from '@/lib/payments/service';
import { ZainCashClient } from '@/lib/payments/zaincash';

export const notifications = new NotificationService(prismaNotifyStore, { email: EmailClient.fromEnv(), whatsapp: WhatsAppClient.fromEnv() });

export const payments = new PaymentService(prismaPaymentStore, { zaincash: ZainCashClient.fromEnv(), fib: FibClient.fromEnv() }, {
  async onPaid(inv) { await notifications.enqueue({ id: `${inv.id}:paid`, type: 'payment_received', userIds: [inv.customerId], vars: { invoice: inv.number, amount: inv.totalIqd.toLocaleString('en') }, at: Date.now() }); },
  async onFailed(inv) { await notifications.enqueue({ id: `${inv.id}:failed:${Date.now()}`, type: 'payment_failed', userIds: [inv.customerId], vars: { invoice: inv.number }, at: Date.now() }); },
});

export const publicBase = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
