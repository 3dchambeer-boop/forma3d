/*
 * FormaCommerce — quotes, invoices and manual payments for the single-page platform (online artifact and
 * offline file). There is no server here, so NO online payment is taken: an admin records cash/transfer
 * payments with a reference (audited in the project log). Online gateways (ZainCash, FIB) live in the
 * server build (src/lib/payments) behind verified webhooks.
 *   quote(estimate, qty, pricePerKg, opts)   lines in whole dinars: material + machine time (+ delivery)
 *   makeInvoice(projectId, lines, now)       number, total, status ISSUED
 *   recordPayment(invoice, actor, entry)     validated manual payment → new invoice object (PAID)
 *   normalizeMobile / waLink                 Iraqi mobile → wa.me click-to-chat
 */
(function (root) {
  'use strict';
  const round = (x, step = 250) => Math.max(0, Math.round(x / step) * step); // prices quoted to 250 IQD

  function quote(est, qty, pricePerKg, { hourly = 1000, setup = 2000, delivery = 0, title = 'قطعة', material = 'PLA' } = {}) {
    if (!est || !(est.mass_g > 0) || !(est.time_min > 0)) throw new Error('لا يوجد تقدير طباعة لهذا التصميم');
    const n = Math.max(1, Math.min(50, Math.floor(qty) || 1));
    const perPiece = round((est.mass_g / 1000) * pricePerKg + (est.time_min / 60) * hourly);
    const lines = [{ description: `طباعة ${title} (${material})`, qty: n, unitIqd: perPiece }, { description: 'تجهيز وتقطيع الملف', qty: 1, unitIqd: round(setup) }];
    if (delivery > 0) lines.push({ description: 'توصيل', qty: 1, unitIqd: round(delivery) });
    return lines;
  }
  function total(lines) {
    let t = 0;
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('العدد يجب أن يكون رقمًا صحيحًا موجبًا');
      if (!Number.isInteger(l.unitIqd) || l.unitIqd < 0) throw new Error('الأسعار بالدينار الصحيح (بلا كسور)');
      if (!String(l.description || '').trim()) throw new Error('كل سطر يحتاج وصفًا');
      t += l.qty * l.unitIqd;
    }
    return t;
  }
  function makeInvoice(projectId, lines, now, by) {
    const t = total(lines);
    if (t <= 0) throw new Error('المجموع يجب أن يكون أكبر من صفر');
    const d = new Date(now);
    const number = `INV-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(projectId).slice(-6).toUpperCase()}`;
    return { number, lines: lines.map((l) => ({ description: String(l.description).trim(), qty: l.qty, unitIqd: l.unitIqd })), totalIqd: t, status: 'ISSUED', issuedAt: now, issuedBy: by, payments: [] };
  }
  const METHODS = { cash: 'نقدًا', transfer: 'تحويل مصرفي', zaincash: 'زين كاش (تحويل يدوي)', fib: 'المصرف العراقي الأول (تحويل يدوي)', other: 'أخرى' };
  function recordPayment(inv, actor, entry, now) {
    if (!inv || inv.status !== 'ISSUED') throw new Error('هذه الفاتورة ليست مفتوحة للدفع');
    if (!actor || actor.role !== 'admin') throw new Error('تسجيل الدفع للمدير فقط');
    if (!METHODS[entry.method]) throw new Error('طريقة دفع غير معروفة');
    const ref = String(entry.reference || '').trim();
    if (ref.length < 3) throw new Error('رقم الإيصال أو العملية مطلوب');
    if (!Number.isInteger(entry.amountIqd) || entry.amountIqd !== inv.totalIqd) throw new Error(`المبلغ يجب أن يساوي مجموع الفاتورة (${inv.totalIqd})`);
    return { ...inv, status: 'PAID', paidAt: now, payments: [...(inv.payments || []), { method: entry.method, reference: ref, amountIqd: entry.amountIqd, by: actor.id, at: now }] };
  }
  // refund of a paid invoice (cash / transfer back, or a provider dashboard refund), recorded by an admin
  function recordRefund(inv, actor, entry, now) {
    if (!inv || inv.status !== 'PAID') throw new Error('الاسترجاع ممكن لفاتورة مدفوعة فقط');
    if (!actor || actor.role !== 'admin') throw new Error('تسجيل الاسترجاع للمدير فقط');
    const reason = String(entry.reason || '').trim(), ref = String(entry.reference || '').trim();
    if (reason.length < 3) throw new Error('سبب الاسترجاع مطلوب');
    if (ref.length < 3) throw new Error('رقم إيصال أو عملية الإرجاع مطلوب');
    if (!Number.isInteger(entry.amountIqd) || entry.amountIqd !== inv.totalIqd) throw new Error(`المبلغ المسترجع يجب أن يساوي مجموع الفاتورة (${inv.totalIqd})`);
    return { ...inv, status: 'REFUNDED', refundedAt: now, refund: { reason, reference: ref, amountIqd: entry.amountIqd, by: actor.id, at: now } };
  }

  // A4 invoice as drawing primitives (rendered to a vector PDF by FormaDrawing.toPDF, Arabic via the browser)
  function invoiceLayout(inv, meta = {}) {
    const W = 210, H = 297, prims = [], L = 18, R = W - 18;
    const line = (a, b, w = 0.25) => prims.push({ t: 'line', a, b, w, style: 'visible' });
    const text = (x, y, s, size, anchor = 'start', extra = {}) => prims.push({ t: 'text', x, y, s: String(s), size, anchor, ...extra });
    const money = (n) => Number(n).toLocaleString('en') + ' IQD';
    const date = (t) => new Date(t).toISOString().slice(0, 10);
    text(L, H - 22, 'FORMA·3D', 7, 'start', { role: 'title' });
    text(R, H - 22, 'فاتورة', 7, 'end', { role: 'title' });
    text(L, H - 30, 'INVOICE ' + inv.number, 3.6);
    text(L, H - 36, 'Issued ' + date(inv.issuedAt) + (inv.paidAt ? '   Paid ' + date(inv.paidAt) : ''), 3);
    const st = { ISSUED: 'بانتظار الدفع', PAID: 'مدفوعة', REFUNDED: 'مُسترجعة', VOID: 'ملغاة' }[inv.status] || inv.status;
    text(R, H - 30, st, 4, 'end');
    if (meta.customer) text(R, H - 38, 'الزبون: ' + meta.customer, 3.4, 'end');
    if (meta.project) text(R, H - 44, 'المشروع: ' + meta.project, 3.4, 'end', { maxW: 110 });
    line([L, H - 50], [R, H - 50], 0.5);
    // table (right-to-left: description on the right, numbers on the left)
    const cols = { amount: L, unit: L + 34, qty: L + 66 };
    let y = H - 58;
    text(R, y, 'البند', 3.2, 'end'); text(cols.qty, y, 'QTY', 3); text(cols.unit, y, 'UNIT', 3); text(cols.amount, y, 'AMOUNT', 3);
    line([L, y - 2.5], [R, y - 2.5]);
    y -= 9;
    for (const l of inv.lines) {
      text(R, y, l.description, 3.4, 'end', { maxW: R - (cols.qty + 18) });
      text(cols.qty, y, String(l.qty), 3.4); text(cols.unit, y, l.unitIqd.toLocaleString('en'), 3.4); text(cols.amount, y, (l.qty * l.unitIqd).toLocaleString('en'), 3.4);
      y -= 8;
    }
    line([L, y + 4], [R, y + 4]);
    text(R, y - 2, 'المجموع', 4, 'end'); text(cols.amount, y - 2, money(inv.totalIqd), 4, 'start', { role: 'title' });
    y -= 14;
    for (const p of inv.payments || []) { text(L, y, `Paid ${money(p.amountIqd)} - ${p.method} - ref ${p.reference} - ${date(p.at)}`, 3); y -= 6; }
    if (inv.refund) { text(L, y, `Refunded ${money(inv.refund.amountIqd)} - ref ${inv.refund.reference} - ${date(inv.refund.at)}`, 3); y -= 6; text(R, y, 'سبب الاسترجاع: ' + inv.refund.reason, 3, 'end', { maxW: R - L }); y -= 6; }
    if (meta.contact) text(L, 20, 'WhatsApp +' + meta.contact, 3);
    text(R, 20, 'المبالغ بالدينار العراقي', 3, 'end');
    line([L, 26], [R, 26]);
    return { sheet: { w: W, h: H, name: 'A4' }, prims, report: { lines: inv.lines.length, total: inv.totalIqd } };
  }
  async function invoicePDF(inv, meta, PDFLib, drawing, opts = {}) {
    return drawing.toPDF(invoiceLayout(inv, meta), PDFLib, { ...opts, title: 'Invoice ' + inv.number });
  }

  function normalizeMobile(input) {
    let d = String(input || '').replace(/[\s\-().]/g, '').replace(/^\+/, '').replace(/^00/, '');
    if (/^964/.test(d)) d = d.slice(3);
    if (/^0/.test(d)) d = d.slice(1);
    return /^7\d{9}$/.test(d) ? '964' + d : null;
  }
  const waLink = (num, text) => { const n = normalizeMobile(num); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : null; };
  const DEFAULT_CONTACT = '9647822678298';

  const api = { quote, total, makeInvoice, recordPayment, recordRefund, invoiceLayout, invoicePDF, normalizeMobile, waLink, METHODS, DEFAULT_CONTACT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaCommerce = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
