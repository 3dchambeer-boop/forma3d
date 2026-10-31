// Phase 8.5 — quotes, invoices, manual payments and WhatsApp links in the single-page platform.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
const require = createRequire(import.meta.url);
const C = require(join(resolve(import.meta.dirname, '../..'), 'services/ai_3d_engine/browser/commerce.js'));

describe('Platform commerce', () => {
  test('a quote is material + machine time per piece (rounded to 250 IQD) plus setup', () => {
    const lines = C.quote({ mass_g: 40, time_min: 90 }, 3, 25000, { hourly: 1000, setup: 2000, title: 'حامل', material: 'PLA' });
    // 0.04 kg * 25000 = 1000 + 1.5 h * 1000 = 1500 -> 2500 per piece
    assert.deepEqual(lines, [{ description: 'طباعة حامل (PLA)', qty: 3, unitIqd: 2500 }, { description: 'تجهيز وتقطيع الملف', qty: 1, unitIqd: 2000 }]);
    assert.equal(C.total(lines), 9500);
    assert.throws(() => C.quote(null, 1, 25000), /لا يوجد تقدير/);
  });
  test('invoices: whole dinars, a description per line, deterministic number', () => {
    const inv = C.makeInvoice('proj_abc123xyz', [{ description: 'x', qty: 2, unitIqd: 5000 }], Date.UTC(2026, 9, 30), 'op1');
    assert.deepEqual([inv.number, inv.totalIqd, inv.status], ['INV-202610-123XYZ', 10000, 'ISSUED']);
    assert.throws(() => C.makeInvoice('p', [{ description: 'x', qty: 1, unitIqd: 99.5 }], 0), /الدينار الصحيح/);
    assert.throws(() => C.makeInvoice('p', [{ description: ' ', qty: 1, unitIqd: 100 }], 0), /وصفًا/);
    assert.throws(() => C.makeInvoice('p', [{ description: 'free', qty: 1, unitIqd: 0 }], 0), /أكبر من صفر/);
  });
  test('manual payment: admin only, reference required, exact amount, once', () => {
    const inv = C.makeInvoice('p1', [{ description: 'x', qty: 1, unitIqd: 12000 }], 0, 'op');
    assert.throws(() => C.recordPayment(inv, { id: 'o', role: 'operator' }, { method: 'cash', reference: 'R-100', amountIqd: 12000 }, 1), /للمدير فقط/);
    assert.throws(() => C.recordPayment(inv, { id: 'a', role: 'admin' }, { method: 'cash', reference: '', amountIqd: 12000 }, 1), /الإيصال/);
    assert.throws(() => C.recordPayment(inv, { id: 'a', role: 'admin' }, { method: 'cash', reference: 'R-100', amountIqd: 11000 }, 1), /يساوي مجموع/);
    const paid = C.recordPayment(inv, { id: 'a', role: 'admin' }, { method: 'zaincash', reference: 'ZC-5521', amountIqd: 12000 }, 7);
    assert.equal(paid.status, 'PAID'); assert.equal(paid.payments[0].by, 'a'); assert.equal(inv.status, 'ISSUED', 'the original object is not mutated');
    assert.throws(() => C.recordPayment(paid, { id: 'a', role: 'admin' }, { method: 'cash', reference: 'again', amountIqd: 12000 }, 8), /ليست مفتوحة/);
  });
  test('WhatsApp click-to-chat uses the configured Iraqi number', () => {
    assert.equal(C.waLink('07822678298', 'INV-1'), 'https://wa.me/9647822678298?text=INV-1');
    assert.equal(C.waLink('12345'), null);
    assert.equal(C.DEFAULT_CONTACT, '9647822678298');
  });
});

describe('Refunds and invoice PDF', () => {
  const B = join(resolve(import.meta.dirname, '../..'), 'services/ai_3d_engine/browser/');
  test('a paid invoice can be refunded by an admin with reason, reference and the full amount', () => {
    const inv = C.recordPayment(C.makeInvoice('p1', [{ description: 'x', qty: 1, unitIqd: 9000 }], 0, 'op'), { id: 'a', role: 'admin' }, { method: 'cash', reference: 'R-1', amountIqd: 9000 }, 1);
    assert.throws(() => C.recordRefund(inv, { id: 'o', role: 'operator' }, { reason: 'defect', reference: 'B-9', amountIqd: 9000 }, 2), /للمدير فقط/);
    assert.throws(() => C.recordRefund(inv, { id: 'a', role: 'admin' }, { reason: '', reference: 'B-9', amountIqd: 9000 }, 2), /السبب|سبب/);
    assert.throws(() => C.recordRefund(inv, { id: 'a', role: 'admin' }, { reason: 'defect', reference: 'B-9', amountIqd: 5000 }, 2), /يساوي/);
    const r = C.recordRefund(inv, { id: 'a', role: 'admin' }, { reason: 'defect', reference: 'B-9', amountIqd: 9000 }, 2);
    assert.equal(r.status, 'REFUNDED'); assert.equal(r.refund.reference, 'B-9');
    assert.throws(() => C.recordRefund(r, { id: 'a', role: 'admin' }, { reason: 'again', reference: 'B-10', amountIqd: 9000 }, 3), /مدفوعة فقط/);
  });
  test('the invoice PDF is one A4 page with the number, every amount and the total', async () => {
    const PDFLib = require(B + 'vendor/pdf-lib.min.js'), D = require(B + 'drawing.js');
    const inv = C.recordPayment(C.makeInvoice('proj_x9', [{ description: 'Print', qty: 3, unitIqd: 2500 }, { description: 'Setup', qty: 1, unitIqd: 2000 }], Date.UTC(2026, 9, 30), 'op'), { id: 'a', role: 'admin' }, { method: 'zaincash', reference: 'ZC-55', amountIqd: 9500 }, Date.UTC(2026, 9, 30));
    const bytes = await C.invoicePDF(inv, { customer: 'Ameer', project: 'Hook', contact: '9647822678298' }, PDFLib, D);
    const doc = await PDFLib.PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.ok(Math.abs(doc.getPage(0).getWidth() - 595.28) < 0.5);
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync } = await import('node:fs');
    const f = join(B, '../../../../tmp-invoice-test.pdf');
    writeFileSync(f, bytes);
    try {
      const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString();
      for (const s of ['INVOICE INV-202610-PROJ_X9'.slice(0, 18), '7,500', '2,000', '9,500 IQD', 'ref ZC-55', 'WhatsApp +9647822678298']) assert.ok(txt.includes(s), s + ' missing in\n' + txt);
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    finally { (await import('node:fs')).rmSync(f, { force: true }); }
  });
});
