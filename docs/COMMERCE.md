# Notifications and payments (server build)

## What runs where
- **Single-page platform (online artifact / offline file).** In-app notices, WhatsApp click-to-chat, quotes, invoices, and manual payments recorded by an admin. No online payment is taken, because there is no server.
- **Server build (Next.js).**
  - `src/lib/notify`: WhatsApp Cloud API, e-mail API, outbox with retries.
  - `src/lib/payments`: ZainCash v2, FIB, state machine, reconciliation.

## Notifications
1. **WhatsApp.** In Meta Business Manager, create a WhatsApp Business app with a verified number. Create the templates named in `src/lib/notify/service.ts → TEMPLATES` (Arabic and English, body variables in the listed order) and wait for approval. Then set:
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_VERIFY_TOKEN`
2. **Webhook.** Register `https://<PUBLIC_BASE_URL>/api/webhooks/whatsapp` (GET handshake, POST signed with X-Hub-Signature-256). Delivery receipts update each message.
3. **E-mail.** Set `EMAIL_API_KEY` and `EMAIL_FROM`; the default is the Resend-style API. E-mail only goes to verified addresses (`User.emailVerified`). There is no verification flow yet.
4. **Scheduler.** Call `POST /api/notifications/dispatch` with header `x-dispatch-token: $NOTIFY_DISPATCH_TOKEN` every minute.

WhatsApp is opt-in per user. Phone numbers are read from the user record at send time and are never stored on deliveries or shown to staff (`maskPhone`).

## Payments
| Provider | Needs | Webhook / callback |
|---|---|---|
| ZainCash v2 | Merchant onboarding. Gives `ZAINCASH_BASE_URL` (test: `https://pg-api-uat.zaincash.iq`), client id/secret, API key and service type. | Ask ZainCash to register `https://<PUBLIC_BASE_URL>/api/webhooks/zaincash` (webhooks run in production only). The customer return URL is `/api/payments/zaincash/return`. |
| First Iraqi Bank | Integration request form. Gives `FIB_BASE_URL` (staging `https://fib.stage.fib.iq`) and client id/secret. | `statusCallbackUrl` = `/api/webhooks/fib`. Its body is unsigned, so the server always re-queries FIB. |

How payment status is decided:
- A payment becomes PAID only through one of these:
  - a verified provider token plus a server-side status query for the same amount;
  - a FIB status query;
  - a manual record by an admin with a reference.
- An amount mismatch never pays; it is audited for review.
- Call `POST /api/payments/reconcile` (same token header) every few minutes. It settles payments whose webhook was missed.
