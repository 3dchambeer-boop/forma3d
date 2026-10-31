// Iraqi mobile numbers → E.164 digits as WhatsApp expects them ("9647XXXXXXXXX", no "+").
// Accepts 07XXXXXXXXX, 7XXXXXXXXX, +9647XXXXXXXXX, 009647XXXXXXXXX, with spaces/dashes.
// Iraqi mobile numbers have 10 digits after the trunk 0, starting with 7 (Asiacell 77x, Zain 78x/79x, Korek 75x).

export function normalizeIraqiMobile(input: string): string | null {
  let d = String(input || '').replace(/[\s\-().]/g, '');
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (/^964/.test(d)) d = d.slice(3);
  if (/^0/.test(d)) d = d.slice(1);
  if (!/^7\d{9}$/.test(d)) return null;
  return '964' + d;
}

/** wa.me click-to-chat link (opens WhatsApp with a prefilled text; no API, no credentials). */
export function clickToChat(numberE164Digits: string, text?: string): string {
  if (!/^\d{8,15}$/.test(numberE164Digits)) throw new Error('number must be digits in international format');
  return `https://wa.me/${numberE164Digits}` + (text ? `?text=${encodeURIComponent(text)}` : '');
}

/** Show only the last digits to staff who are not allowed to see customer contact details. */
export function maskPhone(e164: string): string {
  return e164.length > 4 ? '•'.repeat(e164.length - 4) + e164.slice(-4) : '••••';
}
