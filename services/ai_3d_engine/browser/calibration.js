/*
 * FormaCalibration — printer + material calibration and dimensional compensation.
 *
 *   TESTS                  calibration objects as FormaCAD designs with the dimensions to measure
 *   checkEntry(test, vals) validates a measurement session (caliper values, typo guard)
 *   fitProfile(sessions)   least-squares per axis: printed = s * nominal + b   (s: scale/shrink, b: bleed)
 *                          holes: printed = s_xy * nominal + c  (same scale, own offset)  + confidence
 *   compensate(design, fit) a NEW manufacturing-variant design: the approved design is never modified.
 *                          XY/Z scale 1/s applied to the whole part (exact); holes (vertical cylinders cut
 *                          from the part) widened by -c in the model; outer bleed b is not faked in the
 *                          mesh — it is handed to the slicer as X-Y contour compensation (-b/2 per side).
 *   predict(nominal, fit)  what the printer is expected to produce
 *
 * Calibration math is plain least squares with standard errors; nothing here is estimated by AI.
 */
(function (root) {
  'use strict';

  const r3 = (x) => Math.round(x * 1000) / 1000;
  const sq = (x) => x * x;

  // ---------------------------------------------------------------- calibration objects
  const STEP_SIZES = [60, 45, 30, 15], STEP_H = 3;
  const HOLES = [3, 4, 5, 6, 8, 10];
  const WALLS = [0.8, 1.2, 1.6, 2.0, 2.4];
  const OVERHANGS = [30, 40, 50, 60, 70];
  const BRIDGES = [10, 20, 30, 40];

  const box = (x, y, z, at) => ({ box: { size: [x, y, z] }, translate: at || [0, 0, 0] });
  // 60 segments (chord error < 0.01 mm at Ø10). 64/72/96 here hit a BSP-kernel degeneracy that leaves one
  // non-manifold edge; the validator catches it (REPAIR_REQUIRED) — a known kernel limitation, see the report.
  const cyl = (d, h, at, segments = 60) => ({ cylinder: { d, h, segments }, translate: at });

  const TESTS = [
    {
      key: 'xyz_cube', name_ar: 'مكعب XYZ ‏(20 مم)', kind: 'dimensional',
      how_ar: 'قِس كل محور في منتصف الوجه بالقدمة، بعيدًا عن الحواف والطبقة الأولى.',
      model: box(20, 20, 20),
      measure: [{ id: 'x', axis: 'x', kind: 'outer', nominal: 20, label_ar: 'العرض X' }, { id: 'y', axis: 'y', kind: 'outer', nominal: 20, label_ar: 'العمق Y' }, { id: 'z', axis: 'z', kind: 'outer', nominal: 20, label_ar: 'الارتفاع Z' }],
    },
    {
      key: 'steps', name_ar: 'درجات الأبعاد ‏(60/45/30/15 مم)', kind: 'dimensional',
      how_ar: 'أربع طبقات مربعة متراكبة. قِس عرض كل طبقة على X وY، وارتفاع أعلى كل طبقة عن السطح السفلي.',
      model: { union: STEP_SIZES.map((s, i) => box(s, s, STEP_H, [(60 - s) / 2, (60 - s) / 2, i * STEP_H])) },
      measure: [
        ...STEP_SIZES.flatMap((s, i) => [{ id: `x${i}`, axis: 'x', kind: 'outer', nominal: s, label_ar: `الطبقة ${i + 1} — X` }, { id: `y${i}`, axis: 'y', kind: 'outer', nominal: s, label_ar: `الطبقة ${i + 1} — Y` }]),
        ...STEP_SIZES.map((_, i) => ({ id: `z${i}`, axis: 'z', kind: 'outer', nominal: (i + 1) * STEP_H, label_ar: `ارتفاع أعلى الطبقة ${i + 1}` })),
      ],
    },
    {
      key: 'holes', name_ar: 'ثقوب وأعمدة ‏(3–10 مم)', kind: 'dimensional',
      how_ar: 'قِس كل قطر على محور X (موازيًا للضلع الطويل): الثقوب بفكي القياس الداخلي، والأعمدة في منتصف ارتفاعها.',
      model: { difference: [{ union: [box(80, 36, 4), ...HOLES.map((d, i) => cyl(d, 6, [7 + i * 13, 27, 3.5]))] }, ...HOLES.map((d, i) => cyl(d, 8, [7 + i * 13, 9, -2]))] },
      measure: [...HOLES.map((d) => ({ id: `h${d}`, axis: 'x', kind: 'hole', nominal: d, label_ar: `ثقب Ø${d}` })), ...HOLES.map((d) => ({ id: `p${d}`, axis: 'x', kind: 'outer', nominal: d, label_ar: `عمود Ø${d}` }))],
    },
    {
      key: 'walls', name_ar: 'سماكات الجدران ‏(0.8–2.4 مم)', kind: 'dimensional',
      how_ar: 'قِس سماكة كل جدار في منتصفه. الجدران الرقيقة تكشف تمدّد الخط (bleed) بدقة.',
      model: { union: [box(60, 20, 1.6), ...WALLS.map((t, i) => box(t, 16, 10, [5 + i * 11, 2, 1.5]))] },
      measure: WALLS.map((t) => ({ id: `w${t}`, axis: 'x', kind: 'outer', nominal: t, label_ar: `جدار ${t} مم` })),
    },
    {
      key: 'overhang', name_ar: 'اختبار التدلّي ‏(30°–70°)', kind: 'qualitative',
      how_ar: 'زعانف بزوايا عن العمودي. سجّل أكبر زاوية طُبعت سطحها سليمًا بلا تدلٍّ أو تقشّر.',
      model: { union: [box(108, 14, 2), ...OVERHANGS.map((a, i) => ({ extrude: { points: [[0, 0], [2, 0], [2 + 12 * Math.tan((a * Math.PI) / 180), 12.5], [0, 12.5]], h: 3 }, rotate: [90, 0, 0], translate: [2 + i * 17, 8.5, 1.5] }))] },
      result: { id: 'overhang_max_deg', label_ar: 'أكبر زاوية سليمة (°)', options: OVERHANGS },
    },
    {
      key: 'bridge', name_ar: 'اختبار الجسور ‏(10–40 مم)', kind: 'qualitative',
      how_ar: 'جسور أفقية بين عمودين. سجّل أطول جسر طُبع مستويًا دون ارتخاء ظاهر.',
      model: { union: [box(150, 10, 1.2), ...BRIDGES.flatMap((L, i) => { const x0 = 2 + BRIDGES.slice(0, i).reduce((a, b) => a + b + 12, 0); return [box(4, 10, 10, [x0, 0, 0]), box(4, 10, 10, [x0 + 4 + L, 0, 0]), box(L + 8, 10, 1, [x0, 0, 10])]; })] },
      result: { id: 'bridge_max_mm', label_ar: 'أطول جسر سليم (مم)', options: BRIDGES },
    },
    {
      key: 'first_layer', name_ar: 'الطبقة الأولى ‏(5 مربعات)', kind: 'qualitative',
      how_ar: 'مربعات بسماكة طبقة واحدة في الأركان والوسط. قيّم كل مربع: سليم، مرتفع (خطوط منفصلة)، أو منخفض (شفاف/مضغوط).',
      model: { union: [[10, 10], [170, 10], [10, 170], [170, 170], [90, 90]].map(([x, y]) => box(20, 20, 0.2, [x, y, 0])) },
      result: { id: 'first_layer', label_ar: 'تقييم المربعات', options: ['ok', 'high', 'low'], per: ['أمامي يسار', 'أمامي يمين', 'خلفي يسار', 'خلفي يمين', 'الوسط'] },
    },
    {
      key: 'extrusion', name_ar: 'معايرة التدفّق ‏(جدار خطّين 0.8 مم)', kind: 'flow',
      how_ar: 'اطبع بخطّين محيطيين، بلا ملء ولا سقف. قِس سماكة الجدار في عدة نقاط وأدخل المتوسط.',
      model: { difference: [box(20, 20, 10), box(18.4, 18.4, 12, [0.8, 0.8, 0.6])] },
      measure: [{ id: 'wall', axis: 'x', kind: 'flow', nominal: 0.8, label_ar: 'سماكة الجدار المقيسة' }],
    },
  ];
  const testByKey = (k) => TESTS.find((t) => t.key === k) || null;
  function testDesign(key) {
    const t = testByKey(key);
    if (!t) throw new Error('unknown calibration test ' + key);
    return { name_ar: 'معايرة — ' + t.name_ar, summary_ar: t.how_ar, requirements: [], parameters: [], model: JSON.parse(JSON.stringify(t.model)), checks: [], print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 20, supports: false } };
  }

  // ---------------------------------------------------------------- measurement entry
  // values: {id: number}. Rejects obvious typos (more than 15% or 1.5 mm away from nominal).
  function checkEntry(key, values) {
    const t = testByKey(key);
    if (!t) return { ok: false, errors: ['unknown test'] };
    const errors = [], points = [];
    if (t.kind === 'qualitative') {
      const v = values[t.result.id];
      if (t.result.per) {
        if (!Array.isArray(v) || v.length !== t.result.per.length || v.some((x) => !t.result.options.includes(x))) errors.push('قيّم كل المربعات');
      } else if (!t.result.options.includes(Number(v))) errors.push('اختر قيمة من القائمة');
      return { ok: !errors.length, errors, points, result: errors.length ? null : { [t.result.id]: t.result.per ? v : Number(v) } };
    }
    for (const m of t.measure) {
      const raw = values[m.id];
      if (raw === undefined || raw === null || raw === '') continue;
      const v = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) { errors.push(`${m.label_ar}: قيمة غير صالحة`); continue; }
      if (Math.abs(v - m.nominal) > Math.max(0.15 * m.nominal, 1.5)) { errors.push(`${m.label_ar}: ${v} بعيدة جدًا عن ${m.nominal} — تأكد من القراءة`); continue; }
      points.push({ id: m.id, axis: m.axis, kind: m.kind, nominal: m.nominal, measured: v });
    }
    if (!points.length && !errors.length) errors.push('أدخل قياسًا واحدًا على الأقل');
    return { ok: !errors.length, errors, points };
  }

  // ---------------------------------------------------------------- least squares
  // y = s*x + b with standard errors; with a single distinct x only b is fitted (s fixed at 1).
  function linfit(pts, fixedS, loo) {
    const n = pts.length;
    if (!n) return null;
    const xs = pts.map((p) => p.nominal), ys = pts.map((p) => p.measured);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const sxx = xs.reduce((a, x) => a + sq(x - mx), 0);
    const distinct = new Set(xs.map((x) => x.toFixed(4))).size;
    let s, b, dof;
    if (fixedS != null) { s = fixedS; b = my - s * mx; dof = n - 1; }
    else if (distinct >= 2 && sxx > 1e-9) { s = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx; b = my - s * mx; dof = n - 2; }
    else { s = 1; b = my - mx; dof = n - 1; }
    const res = pts.map((p) => p.measured - (s * p.nominal + b));
    const sse = res.reduce((a, r) => a + r * r, 0);
    const sigma = dof > 0 ? Math.sqrt(sse / dof) : null;
    const rms = Math.sqrt(sse / n);
    const seS = fixedS == null && distinct >= 2 && sigma != null ? sigma / Math.sqrt(sxx) : null;
    const seB = sigma != null ? sigma * Math.sqrt(1 / n + (fixedS == null && distinct >= 2 ? sq(mx) / sxx : 0)) : null;
    // leave-one-out: a point is an outlier when the line through the others misses it by > 4 sigma (and > 0.1 mm);
    // a plain 3-sigma test fails here because the bad reading inflates sigma itself
    const outliers = [];
    if (n >= 5 && !loo) pts.forEach((p, i) => {
      const o = linfit(pts.filter((_, j) => j !== i), fixedS, true);
      if (o && o.sigma != null && Math.abs(p.measured - (o.s * p.nominal + o.b)) > Math.max(4 * o.sigma, 0.1)) outliers.push(p.id);
    });
    return { s, b, n, distinct, rms, sigma, se_s: seS, se_b: seB, scaleFitted: fixedS == null && distinct >= 2, outliers };
  }

  function confidence(f) {
    if (!f) return 'none';
    if (f.n >= 4 && f.distinct >= 3 && f.rms <= 0.05 && (f.se_s == null || f.se_s <= 0.002)) return 'high';
    if (f.n >= 3 && f.distinct >= 2 && f.rms <= 0.1) return 'medium';
    return 'low';
  }

  // sessions: [{test, at, points:[...], result?}] — the latest session of each test is used
  function fitProfile(sessions) {
    const latest = new Map();
    for (const s of (sessions || []).slice().sort((a, b) => a.at - b.at)) latest.set(s.test, s);
    const pts = [...latest.values()].flatMap((s) => (s.points || []).map((p) => ({ ...p, id: s.test + ':' + p.id })));
    const outer = pts.filter((p) => p.kind === 'outer');
    const axis = (a) => outer.filter((p) => p.axis === a || (a !== 'z' && p.axis === 'xy'));
    const fit = { axes: {}, warnings: [], qualitative: {} };
    for (const a of ['x', 'y', 'z']) {
      const f = linfit(axis(a));
      if (f) { f.confidence = confidence(f); fit.axes[a] = f; }
    }
    const holes = pts.filter((p) => p.kind === 'hole');
    if (holes.length) {
      // holes are measured along X, so they share the X scale and get their own offset
      const sxy = fit.axes.x && fit.axes.x.scaleFitted ? fit.axes.x.s : null;
      const f = linfit(holes, sxy);
      f.confidence = confidence(f);
      f.scaleFrom = sxy != null ? 'x' : f.scaleFitted ? 'holes' : 'none';
      fit.holes = f;
    }
    const flow = pts.find((p) => p.kind === 'flow');
    if (flow) fit.flow = { nominal: flow.nominal, measured: flow.measured, multiplier: r3(flow.nominal / flow.measured) };
    for (const s of latest.values()) if (s.result) Object.assign(fit.qualitative, s.result);
    for (const [a, f] of Object.entries(fit.axes)) {
      if (Math.abs(f.s - 1) > 0.03) fit.warnings.push(`${a.toUpperCase()}: scale ${r3(f.s)} differs from 1 by more than 3% — check steps/mm, belts or the measurement`);
      if (Math.abs(f.b) > 0.6) fit.warnings.push(`${a.toUpperCase()}: offset ${r3(f.b)} mm is unusually large — check flow and first layer`);
      if (f.outliers.length) fit.warnings.push(`${a.toUpperCase()}: outliers ${f.outliers.join(', ')} — re-measure`);
    }
    if (fit.flow && Math.abs(fit.flow.multiplier - 1) > 0.15) fit.warnings.push('flow multiplier is more than 15% from 1 — re-check the measurement');
    const confs = Object.values(fit.axes).map((f) => f.confidence);
    fit.confidence = !confs.length ? 'none' : confs.includes('low') || confs.length < 3 ? 'low' : confs.includes('medium') ? 'medium' : 'high';
    return fit;
  }

  const predict = (nominal, f) => f.s * nominal + f.b;

  // ---------------------------------------------------------------- manufacturing variant
  // Widen vertical cylinders that are cut out of the part (negative polarity) by `delta` mm in diameter.
  function adjustHoles(node, delta, negative, stats, path = 'model') {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => adjustHoles(n, delta, negative, stats, `${path}[${i}]`));
    const out = { ...node };
    const scaled = node.scale !== undefined;
    if (node.difference) out.difference = node.difference.map((c, i) => adjustHoles(c, delta, i === 0 ? negative : !negative, stats, `${path}.difference[${i}]`));
    for (const k of ['union', 'intersection']) if (node[k]) out[k] = node[k].map((c, i) => adjustHoles(c, delta, negative, stats, `${path}.${k}[${i}]`));
    for (const k of ['linear_array', 'polar_array', 'mirror_copy']) if (node[k]) out[k] = { ...node[k], child: adjustHoles(node[k].child, delta, negative, stats, `${path}.${k}.child`) };
    if (node.cylinder && negative) {
      const rot = node.rotate || [0, 0, 0], vertical = Math.abs(Number(rot[0]) || 0) % 180 === 0 && Math.abs(Number(rot[1]) || 0) % 180 === 0 && !Number.isNaN(Number(rot[0])) && !Number.isNaN(Number(rot[1]));
      if (!vertical || scaled) stats.skipped.push(path);
      else {
        const c = { ...node.cylinder }, add = (v, k) => (typeof v === 'number' ? v + k : `(${v})+${k}`);
        if (c.d !== undefined) c.d = add(c.d, delta); else if (c.r !== undefined) c.r = add(c.r, delta / 2);
        if (c.d2 !== undefined) c.d2 = add(c.d2, delta); else if (c.r2 !== undefined) c.r2 = add(c.r2, delta / 2);
        out.cylinder = c; stats.adjusted.push(path);
      }
    }
    return out;
  }

  const isVariant = (design) => !!(design && (design.manufacturing_variant || (design.model && design.model.name === 'calibration compensation')));

  function compensate(design, fit, { allowLow = false } = {}) {
    const A = fit.axes || {};
    const refuse = (msg) => { const e = new Error(msg); e.code = 'CALIBRATION_NOT_USABLE'; throw e; };
    // compensation is applied to the approved design only, never to a variant: applying it twice would double
    // every correction (a 0.25 mm hole fix becomes 0.5 mm)
    if (isVariant(design)) { const e = new Error('this design is already a compensated manufacturing variant; compensate the approved original instead'); e.code = 'ALREADY_COMPENSATED'; throw e; }
    for (const a of ['x', 'y', 'z']) if (!A[a]) refuse(`no ${a.toUpperCase()} calibration — print and measure the XYZ cube or the steps`);
    if (!allowLow && fit.confidence === 'low') refuse('calibration confidence is low — measure more points (steps + cube) before compensating');
    if (Object.values(A).some((f) => Math.abs(f.s - 1) > 0.05)) refuse('a measured scale is more than 5% off — fix the printer before compensating');
    const k = ['x', 'y', 'z'].map((a) => (A[a].scaleFitted ? 1 / A[a].s : 1));
    const stats = { adjusted: [], skipped: [] };
    const holeDelta = fit.holes && fit.holes.confidence !== 'low' ? -fit.holes.b : 0;
    let model = JSON.parse(JSON.stringify(design.model));
    if (Math.abs(holeDelta) >= 0.005) model = adjustHoles(model, r3(holeDelta), false, stats);
    const variant = JSON.parse(JSON.stringify(design));
    variant.model = { name: 'calibration compensation', union: [model], scale: k.map((v) => +v.toFixed(6)) };
    variant.checks = []; // the original checks are written in nominal coordinates; the variant is verified by prediction
    variant.manufacturing_variant = { scale: k.map((v) => +v.toFixed(6)), hole_delta_mm: r3(holeDelta), confidence: fit.confidence };
    const bxy = ((A.x.b || 0) + (A.y.b || 0)) / 2;
    const slicer = {
      xy_contour_compensation_mm: r3(-bxy / 2),
      xy_hole_compensation_mm: 0,
      note_en: 'Outer bleed is corrected by the slicer (OrcaSlicer/PrusaSlicer "X-Y contour compensation"); holes are already compensated in this model, so leave hole compensation at 0. In Cura use "Horizontal Expansion" and set "Hole Horizontal Expansion" to cancel it.',
    };
    if (fit.flow) slicer.flow_ratio = fit.flow.multiplier;
    return {
      design: variant,
      compensation: { scale: k.map((v) => +v.toFixed(6)), hole_delta_mm: r3(holeDelta), holes_adjusted: stats.adjusted, holes_skipped: stats.skipped, slicer, confidence: fit.confidence, z_offset_mm: r3(A.z.b) },
    };
  }

  const api = { TESTS, testByKey, testDesign, checkEntry, linfit, fitProfile, confidence, predict, compensate, adjustHoles, isVariant };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaCalibration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
