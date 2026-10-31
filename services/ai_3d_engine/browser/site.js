/*
 * FormaSite — the content the administrator manages for the public welcome page (CMS), validated so that
 * publishing can never inject markup or script: every field is plain text (rendered with textContent), links must be
 * https:// (or mailto:), colours are #rrggbb and must keep WCAG AA contrast, fonts come from an approved list.
 *
 *   DEFAULT_SITE                     the content shipped with the platform
 *   sanitizeSite(input)              -> {ok, site, errors[]}   (errors in Arabic, each naming its field)
 *   contrast(hexA, hexB)             -> WCAG 2.x contrast ratio
 *   publish(history, site, by, now)  -> new history with a numbered revision (latest 50 kept)
 *   revisionOf(history, n)           -> the content of revision n (for rollback into the draft)
 */
(function (root) {
  'use strict';

  const FONTS = ['IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Cairo', 'Tajawal', 'system-ui'];
  const DEFAULT_SITE = {
    headline_en: 'Your Imagination. Engineered Into Reality.',
    headline_ar: 'من الفكرة إلى الواقع، هندسة بلا حدود.',
    sub_ar: 'صِف القطعة التي تحتاجها؛ يصمّمها الذكاء الاصطناعي بنموذج هندسي دقيق، يراجعها مهندس، ثم نطبعها لك.',
    sub_en: 'Describe the part you need. AI designs an exact engineering model, an engineer reviews it, and we print it for you.',
    cta_ar: 'ابدأ مشروعك', cta_en: 'Start a project',
    announcement_ar: '', announcement_en: '',
    pillars: [
      { title_ar: 'تصميم بالذكاء الاصطناعي', title_en: 'AI design', text_ar: 'من وصف بالعربية أو الإنجليزية إلى نموذج بارامتري يمكن تعديله.', text_en: 'From an Arabic or English description to an editable parametric model.' },
      { title_ar: 'هندسة دقيقة', title_en: 'Precision engineering', text_ar: 'مقاسات تُقاس على الملف نفسه، رسومات هندسية، وتصدير STEP.', text_en: 'Dimensions measured on the file itself, engineering drawings and STEP export.' },
      { title_ar: 'تصنيع حقيقي', title_en: 'Real manufacturing', text_ar: 'مراجعة بشرية، معايرة الطابعة، ثم طباعة الملف المعتمد نفسه.', text_en: 'Human review, printer calibration, then the approved file itself is printed.' },
    ],
    faq: [
      { q_ar: 'ما الصيغ التي أحصل عليها؟', q_en: 'Which files do I get?', a_ar: 'STL و3MF وOBJ وGLB، وSTEP عندما تكون خدمة OpenCascade متاحة.', a_en: 'STL, 3MF, OBJ and GLB, and STEP when the OpenCascade service is available.' },
      { q_ar: 'هل يراجع إنسان التصميم قبل الطباعة؟', q_en: 'Does a person review the design before printing?', a_ar: 'نعم. لا يُطبع أي تصميم قبل اعتماده من مصمّم مراجع.', a_en: 'Yes. Nothing is printed before a reviewing designer approves it.' },
    ],
    contact_email: '', links: [],
    seo_title: 'CMG · FORMA·3D', seo_description: 'AI design, precision engineering and real 3D manufacturing.',
    default_language: 'ar',
    accent: '#c2410c', font: 'IBM Plex Sans Arabic',
    maintenance: { on: false, message_ar: 'المنصة في صيانة قصيرة. نعود خلال دقائق.', message_en: 'Short maintenance. Back in a few minutes.' },
  };

  const LIMITS = { headline: 120, sub: 400, cta: 40, announcement: 300, pillarTitle: 60, pillarText: 240, q: 200, a: 1200, seoTitle: 70, seoDesc: 160, maint: 300 };
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  function lum(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // plain text: no control characters except newlines, no bidi overrides that could disguise text, trimmed, bounded
  const text = (v, max, field, errors) => {
    const s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').trim();
    if (s.length > max) errors.push(`${field}: أطول من ${max} حرفًا`);
    return s.slice(0, max);
  };
  function safeUrl(v) {
    try {
      const u = new URL(String(v || '').trim());
      return (u.protocol === 'https:' || u.protocol === 'mailto:') && !u.username && !u.password ? u.toString() : null;
    } catch (e) { return null; }
  }

  function sanitizeSite(input) {
    const i = input || {}, e = [], d = DEFAULT_SITE;
    const site = {
      headline_en: text(i.headline_en ?? d.headline_en, LIMITS.headline, 'العنوان (EN)', e),
      headline_ar: text(i.headline_ar ?? d.headline_ar, LIMITS.headline, 'العنوان (AR)', e),
      sub_ar: text(i.sub_ar ?? d.sub_ar, LIMITS.sub, 'الوصف (AR)', e), sub_en: text(i.sub_en ?? d.sub_en, LIMITS.sub, 'الوصف (EN)', e),
      cta_ar: text(i.cta_ar ?? d.cta_ar, LIMITS.cta, 'زر البدء (AR)', e), cta_en: text(i.cta_en ?? d.cta_en, LIMITS.cta, 'زر البدء (EN)', e),
      announcement_ar: text(i.announcement_ar, LIMITS.announcement, 'الإعلان (AR)', e), announcement_en: text(i.announcement_en, LIMITS.announcement, 'الإعلان (EN)', e),
      pillars: (Array.isArray(i.pillars) ? i.pillars : d.pillars).slice(0, 4).map((p, k) => ({
        title_ar: text(p.title_ar, LIMITS.pillarTitle, `الركيزة ${k + 1}`, e), title_en: text(p.title_en, LIMITS.pillarTitle, `pillar ${k + 1}`, e),
        text_ar: text(p.text_ar, LIMITS.pillarText, `نص الركيزة ${k + 1}`, e), text_en: text(p.text_en, LIMITS.pillarText, `pillar text ${k + 1}`, e) })),
      faq: (Array.isArray(i.faq) ? i.faq : d.faq).slice(0, 12).map((f, k) => ({
        q_ar: text(f.q_ar, LIMITS.q, `سؤال ${k + 1}`, e), q_en: text(f.q_en, LIMITS.q, `question ${k + 1}`, e),
        a_ar: text(f.a_ar, LIMITS.a, `جواب ${k + 1}`, e), a_en: text(f.a_en, LIMITS.a, `answer ${k + 1}`, e) })).filter((f) => f.q_ar || f.q_en),
      contact_email: '', links: [],
      seo_title: text(i.seo_title ?? d.seo_title, LIMITS.seoTitle, 'عنوان SEO', e), seo_description: text(i.seo_description ?? d.seo_description, LIMITS.seoDesc, 'وصف SEO', e),
      default_language: i.default_language === 'en' ? 'en' : 'ar',
      accent: d.accent, font: FONTS.includes(i.font) ? i.font : d.font,
      maintenance: { on: !!(i.maintenance && i.maintenance.on), message_ar: text(i.maintenance && i.maintenance.message_ar ? i.maintenance.message_ar : d.maintenance.message_ar, LIMITS.maint, 'رسالة الصيانة', e), message_en: text(i.maintenance && i.maintenance.message_en ? i.maintenance.message_en : d.maintenance.message_en, LIMITS.maint, 'maintenance message', e) },
    };
    if (i.contact_email) {
      if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(i.contact_email).trim()) && String(i.contact_email).length <= 120) site.contact_email = String(i.contact_email).trim();
      else e.push('البريد: صيغة غير صالحة');
    }
    for (const [k, l] of (Array.isArray(i.links) ? i.links : []).slice(0, 8).entries()) {
      const url = safeUrl(l && l.url);
      if (!url) { e.push(`الرابط ${k + 1}: يُقبل https:// أو mailto: فقط`); continue; }
      site.links.push({ label: text(l.label, 40, `اسم الرابط ${k + 1}`, e) || new URL(url).hostname, url });
    }
    if (i.accent != null) {
      if (!hexRe.test(String(i.accent))) e.push('اللون المميّز: يُقبل #RRGGBB فقط');
      else if (contrast(i.accent, '#ffffff') < 4.5) e.push(`اللون المميّز: التباين مع الأبيض ${contrast(i.accent, '#ffffff').toFixed(2)}:1 أقل من 4.5:1 (WCAG AA)`);
      else site.accent = String(i.accent).toLowerCase();
    }
    if (i.font != null && !FONTS.includes(i.font)) e.push('الخط: اختر من القائمة المعتمدة');
    return { ok: e.length === 0, site, errors: e };
  }

  function publish(history, site, by, now) {
    const revs = (history && history.revisions) || [];
    const n = (revs.length ? revs[revs.length - 1].n : 0) + 1;
    return { revisions: [...revs, { n, at: now, by, site }].slice(-50), current: n };
  }
  const revisionOf = (history, n) => (((history && history.revisions) || []).find((r) => r.n === n) || {}).site || null;

  const api = { DEFAULT_SITE, FONTS, sanitizeSite, contrast, publish, revisionOf, safeUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaSite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
