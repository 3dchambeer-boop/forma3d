"""Derive platform.template.html from designer.template.html (shared studio code) + platform.js."""
from pathlib import Path

here = Path(__file__).parent
s = (here / "designer.template.html").read_text()


def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n == count, (n, a[:80])
    s = s.replace(a, b)


rep("<title>مصمّم فورما</title>", "<title>منصة فورما</title>")
rep("/* Layout: workshop bench — conversation with the designer on one side, the part on the build plate on the other */",
    "/* Layout: app bar with role navigation; each view is a workbench — the studio keeps the conversation beside the part on the build plate */")

# ---------------------------------------------------------------- CSS
rep("@media (prefers-reduced-motion: reduce)", """.appbar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 8px 14px }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg) }
.brand { display: flex; align-items: baseline; gap: 8px; text-decoration: none; color: var(--ink) }
.brand b { font-family: var(--display); font-size: 19px; letter-spacing: -.01em }
.brand small { color: var(--muted); font-size: 12px }
.mark { width: 14px; height: 14px; border-radius: 3px; background: repeating-linear-gradient(0deg, var(--accent) 0 2px, transparent 2px 4px); align-self: center }
#nav { display: flex; flex-wrap: wrap; gap: 2px; flex: 1 }
#nav a { text-decoration: none; color: var(--muted); font-weight: 500; padding: 5px 10px; border-radius: 7px; display: inline-flex; gap: 6px; align-items: center }
#nav a:hover { color: var(--ink); background: var(--soft) }
#nav a[aria-current="page"] { color: var(--ink); background: var(--soft); box-shadow: inset 0 -2px 0 var(--accent) }
.count { font-family: var(--mono); font-size: 11.5px; background: var(--accent); color: var(--accent-ink); border-radius: 999px; padding: 0 6px; line-height: 1.5 }
.who { display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
.who select { width: auto; padding: 4px 8px; font-size: 13px }
.rolechip { font-size: 12.5px; font-weight: 600; color: var(--ai); border: 1px solid currentColor; border-radius: 999px; padding: 1px 10px }
.wrap { grid-template-columns: minmax(0, 1fr) } /* the shell column never grows past the screen */
.view { display: grid; gap: 16px; min-width: 0; grid-template-columns: minmax(0, 1fr) }
/* ---- CMG archive / control center */
.pagehead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 12px }
.pagehead h1 { margin: 0 }
.crumbs { font-size: 13px; color: var(--muted) } .crumbs a { color: inherit }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center } .filters input[type=search] { flex: 1 1 240px; min-width: 0 } .filters select { width: auto }
.custgrid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)) }
.custcard, .projcard { display: grid; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; color: var(--ink); text-decoration: none; transition: border-color .15s, transform .15s; min-width: 0 }
.custcard:hover, .projcard:hover { border-color: var(--accent) } .custcard:focus-visible, .projcard:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.cc-head { display: flex; gap: 10px; align-items: center } .cc-head > div { flex: 1; min-width: 0 } .cc-head b { overflow-wrap: anywhere }
.avatar { inline-size: 36px; block-size: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); color: var(--ink); font-weight: 700; flex: none }
.avatar.big { inline-size: 64px; block-size: 64px; font-size: 26px }
.cc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 10px; margin: 0 } .cc-stats dt { font-size: 11.5px; color: var(--muted) } .cc-stats dd { margin: 0 0 4px; font-weight: 600 }
.custhead { display: flex; gap: 16px; align-items: center; flex-wrap: wrap } .custhead h1 { margin: 0 }
.projgrid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); margin-bottom: 12px }
.projcard { grid-template-columns: 72px 1fr; align-items: start }
.pc-thumb { block-size: 72px; border-radius: 9px; background: repeating-linear-gradient(0deg, var(--soft) 0 2px, transparent 2px 6px), var(--bg); display: grid; place-items: center; align-content: center; gap: 2px; color: var(--accent); font-size: 26px }
.pc-thumb small { font-size: 10px; color: var(--muted) } .pc-body { min-width: 0; display: grid; gap: 4px } .pc-body b { overflow-wrap: anywhere }
.bpipe { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px }
.bpipe li { display: grid; grid-template-columns: minmax(110px, 160px) 1fr 3ch; gap: 10px; align-items: center }
.pl-bar { block-size: 10px; background: var(--soft); border-radius: 99px; overflow: hidden } .pl-bar i { display: block; block-size: 100%; border-radius: 99px; background: currentColor; transition: inline-size .4s }
.tone-ok { color: var(--ok) } .tone-warn { color: var(--warn) } .tone-bad { color: var(--bad) } .tone-info { color: var(--ai) } .tone-hot { color: var(--accent) } .tone-muted { color: var(--muted) }
.ptimeline { list-style: none; margin: 0; padding: 0 12px 0 0; border-inline-start: 2px solid var(--line); display: grid; gap: 12px }
.ptimeline li { position: relative; padding-inline-start: 14px } .ptimeline li::before { content: ""; position: absolute; inset-inline-start: -7px; top: 6px; inline-size: 10px; block-size: 10px; border-radius: 50%; background: var(--accent) }
.ptimeline time { display: block; font-size: 12px; color: var(--muted) }
.pager { justify-content: center }
.searchbtn { font-family: var(--mono) }
.palette-back { position: fixed; inset: 0; background: rgb(10 14 20 / .45); z-index: 50; display: grid; justify-items: center; align-items: start; padding: 10vh 16px 16px }
.palette { inline-size: min(640px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 20px 60px rgb(0 0 0 / .3); padding: 12px; display: grid; gap: 8px }
.palette input { font-size: 16px } .palette ul { list-style: none; margin: 0; padding: 0; max-block-size: 50vh; overflow: auto }
.palette li { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer } .palette li small { grid-column: 2 }
.palette li[aria-selected="true"], .palette li:hover { background: var(--soft) }
@media (prefers-reduced-motion: reduce) { .pl-bar i, .custcard, .projcard { transition: none } }
.pl-name { font-size: 13px; overflow-wrap: anywhere }
/* ---- CMG brand + welcome (the hero is always dark: a lit stage for the part) */
:root { --brand: #c2410c; --wl-bg: #0c1117; --wl-ink: #e9eef3; --wl-muted: #93a1ae; --wl-line: rgb(255 255 255 / .09) }
.cmgtxt { font-family: var(--display); letter-spacing: .28em; font-size: 15px; padding-inline-end: 2px; border-bottom: 2px solid var(--brand) }
body.on-welcome .appbar, body.on-welcome #standalone { display: none }
#v-welcome { gap: 0 }
.wl { color: var(--wl-ink); background: radial-gradient(1200px 600px at 75% -10%, rgb(255 255 255 / .07), transparent 60%), linear-gradient(180deg, #0c1117, #111a23 55%, #0c1117); border-radius: 18px; overflow: hidden; padding: clamp(16px, 4vw, 44px); display: grid; gap: clamp(28px, 6vw, 64px); position: relative; isolation: isolate }
.wl::before { content: ""; position: absolute; inset: 0; z-index: -1; background-image: linear-gradient(var(--wl-line) 1px, transparent 1px), linear-gradient(90deg, var(--wl-line) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse at 70% 30%, #000 20%, transparent 75%) }
.wl a { color: var(--wl-ink) }
.wl-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap }
.wl-brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; color: var(--wl-ink) }
.wl-brand .cmgmark { color: var(--wl-ink) }
.wl-word { font-family: var(--display); font-weight: 600; letter-spacing: .06em; font-size: 15px; color: var(--wl-muted) }
.wl-actions { display: flex; gap: 8px; align-items: center }
.wl-lang { background: none; border: 1px solid var(--wl-line); color: var(--wl-muted); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer }
.wl-lang:hover, .wl-lang:focus-visible { color: var(--wl-ink); border-color: var(--wl-muted) }
.wl .btn.wl-ghost { background: transparent; color: var(--wl-ink); border-color: rgb(255 255 255 / .22) }
.wl .btn.primary.wl-cta { background: var(--brand); border-color: var(--brand); color: #fff; padding-inline: 22px }
.wl-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(20px, 4vw, 48px); align-items: center }
.wl-kicker { color: var(--wl-muted); font-size: 12.5px; letter-spacing: .08em; margin: 0 0 14px }
.wl h1 { font-family: var(--brand-font, var(--display)); font-size: clamp(30px, 5.2vw, 58px); line-height: 1.12; letter-spacing: -.01em; margin: 0 0 16px; text-wrap: balance }
.wl[lang] h1, .wl-sub { max-inline-size: 22ch }
.wl-sub { color: #c3cdd6; font-size: clamp(15px, 1.6vw, 18px); line-height: 1.7; max-inline-size: 46ch; margin: 0 0 24px }
.wl-figure { margin: 0; display: grid; gap: 10px }
.wl-stage { position: relative; aspect-ratio: 4 / 3; border-radius: 16px; background: radial-gradient(closest-side, rgb(255 255 255 / .06), transparent), #0a0f15; border: 1px solid var(--wl-line); overflow: hidden }
.wl-stage canvas { position: absolute; inset: 0; inline-size: 100%; block-size: 100% }
.wl-caption { color: var(--wl-muted); font-size: 12.5px; margin: 0 }
.wl-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--wl-line); border: 1px solid var(--wl-line); border-radius: 14px; overflow: hidden }
.wl-steps li { background: #0e151c; padding: 18px; display: grid; gap: 6px; align-content: start }
.wl-steps p, .wl-pillars p, .wl-faq p { color: #b5c0ca; margin: 0; line-height: 1.6 }
.wl-n { font-family: var(--mono); color: var(--brand); font-size: 12px }
.wl-pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 14px }
.wl-pillars article { border-top: 1px solid var(--wl-line); padding-top: 16px }
.wl-pillars h2, .wl-faq h2 { font-size: 18px; margin: 0 0 8px; color: var(--wl-ink) }
.wl-faq details { border-bottom: 1px solid var(--wl-line); padding: 12px 0 } .wl-faq summary { cursor: pointer; font-weight: 600 }
.wl-foot { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; justify-content: space-between; border-top: 1px solid var(--wl-line); padding-top: 20px; color: var(--wl-muted) }
.wl-foot .row a { color: var(--wl-muted) }
.wl-announce { background: var(--brand); color: #fff; text-align: center; padding: 8px 14px; border-radius: 12px; margin-bottom: 12px; font-weight: 600 }
.wl-preview { background: #fef3c7; color: #713f12; padding: 8px 14px; border-radius: 12px; margin-bottom: 12px }
.wl-maint { min-block-size: 70vh; place-content: center; text-align: center; justify-items: center }
.wl-hero > *, .wl-how, .wl-pillars { animation: wl-in .7s cubic-bezier(.2, .7, .2, 1) both } .wl-hero > :nth-child(2) { animation-delay: .12s } .wl-how { animation-delay: .2s } .wl-pillars { animation-delay: .28s }
@keyframes wl-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .wl-hero > *, .wl-how, .wl-pillars { animation: none } }
@media (max-width: 820px) { .wl-hero { grid-template-columns: minmax(0, 1fr) } .wl-steps { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
@media (max-width: 460px) { .wl-steps { grid-template-columns: minmax(0, 1fr) } }
.cms { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px } .cms h3 { margin: 14px 0 4px } .cms textarea { min-block-size: 64px } .chk-row { display: flex; gap: 8px; align-items: center }
/* phones: the bar does not stick, and the navigation is one row that scrolls inside itself (never the page) */
@media (max-width: 720px) {
  .appbar { position: static; padding: 8px 10px }
  #nav { flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; overscroll-behavior-x: contain }
  #nav a { white-space: nowrap; flex: none }
  .bpipe li { grid-template-columns: minmax(90px, 120px) 1fr 3ch }
}
.view > h1 { margin-top: 6px }
.hello { display: grid; gap: 8px }
.pill { display: inline-flex; font-size: 12.5px; font-weight: 600; border-radius: 999px; padding: 1px 10px; border: 1px solid currentColor; white-space: nowrap }
.pill.ok { color: var(--ok) } .pill.warn { color: var(--warn) } .pill.bad { color: var(--bad) } .pill.info { color: var(--ai) } .pill.hot { color: var(--accent) } .pill.muted { color: var(--muted) }
.tag { font-family: var(--mono); font-size: 12px; color: var(--muted) }
.ptitle { display: flex; flex-wrap: wrap; gap: 8px; align-items: center }
.pbar { gap: 10px }
ol.life { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; font-size: 12.5px; counter-reset: s }
ol.life li { counter-increment: s; padding: 2px 10px 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted) }
ol.life li::before { content: counter(s); font-family: var(--mono); margin-inline-end: 6px; opacity: .7 }
ol.life li[data-state="done"] { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--line)) }
ol.life li[data-state="now"] { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); font-weight: 600 }
ol.life li[data-state="bad"] { color: var(--bad); border-color: var(--bad); font-weight: 600 }
.pnotes { display: grid; gap: 6px }
.notice.warnbox { color: var(--warn); border-color: var(--warn); border-style: solid }
.subform { display: grid; gap: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--soft) }
.formgrid { display: grid; gap: 6px; max-width: 520px }
.gate p { margin: 0 }
.check { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; color: var(--ink) }
.check input { margin-top: 5px }
details.timeline summary, details.adder summary { cursor: pointer; color: var(--muted); font-size: 13px }
details.timeline ol, ol.activity { margin: 8px 0 0; padding-inline-start: 18px; display: grid; gap: 4px; font-size: 13px }
details.timeline time, ol.activity time { color: var(--muted); font-size: 12px; margin-inline-start: 8px }
.block { display: block }
.empty { color: var(--muted); margin: 0; padding: 14px; border: 1px dashed var(--line); border-radius: 8px; text-align: center }
.caltests { display: grid; gap: 8px }
.caltest { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; border-bottom: 1px solid var(--line); padding: 6px 0 }
.calgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px }
.calgrid label { display: grid; gap: 3px; font-size: 12.5px; color: var(--muted) }
.calgrid input { font-family: var(--mono) }
.invlines { display: grid; gap: 6px }
.invline { display: grid; grid-template-columns: minmax(0, 1fr) 64px 110px auto; gap: 6px; align-items: center }
.invline input[type=number] { font-family: var(--mono); direction: ltr }
.revacts { display: flex; flex-wrap: wrap; gap: 4px 10px; white-space: normal }
.revs { display: grid; gap: 8px; margin-top: 8px }
.tbl a, ol.activity a { color: var(--ink); font-weight: 600 }
.board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start }
@media (max-width: 900px) { .board { grid-template-columns: minmax(0, 1fr) } }
.col { display: grid; gap: 10px; background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 12px; min-width: 0 }
.job { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: grid; gap: 8px; min-width: 0 }
.jtitle { font-weight: 600; color: var(--ink) }
.job .facts { grid-template-columns: minmax(0, 1fr) }
a.btn { text-decoration: none; display: inline-flex; align-items: center }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 2px }
.stat span { font-size: 12.5px; color: var(--muted) }
.stat b { font-family: var(--display); font-size: 26px; font-variant-numeric: tabular-nums }
.stat small { color: var(--muted); font-size: 12px }
.prices { display: flex; flex-wrap: wrap; gap: 10px; align-items: center }
.toast { position: fixed; z-index: 20; inset-inline: max(16px, env(safe-area-inset-left, 0px)) max(16px, env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); margin-inline: auto; max-width: 520px; background: var(--ink); color: var(--bg); border-radius: 10px; padding: 10px 14px; font-size: 14px; box-shadow: 0 4px 18px rgb(0 0 0 / .25) }
.toast.bad { background: var(--bad); color: #fff }
.accounts { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px }
.account { font: inherit; text-align: start; display: grid; gap: 2px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--soft); color: var(--ink); cursor: pointer }
.account:hover { border-color: var(--accent) }
.btn.small { padding: 4px 10px; font-size: 13px }
.linkbtn { font: inherit; font-size: 13px; background: none; border: 0; padding: 0; color: var(--ai); text-decoration: underline; cursor: pointer }
.octo { font-family: var(--mono); font-size: 12px }
details.timeline time, ol.activity time { display: inline-block; unicode-bidi: isolate; direction: rtl }
.param input:disabled { opacity: .65; cursor: not-allowed }
@media (prefers-reduced-motion: reduce)""")

# ---------------------------------------------------------------- markup
rep("""  <header>
    <h1>مصمّم فورما</h1>""", """  <header class="appbar">
    <a class="brand" href="#welcome" aria-label="CMG FORMA·3D"><b class="cmgtxt">CMG</b><span class="mark" aria-hidden="true"></span><b>FORMA·3D</b><small>تصميم ذكي · هندسة · تصنيع</small></a>
    <nav id="nav" aria-label="أقسام المنصة" hidden></nav>
    <div class="who" id="who"></div>
  </header>
  <main class="view" id="v-home" hidden></main>
  <main class="view" id="v-review" hidden></main>
  <main class="view" id="v-print" hidden></main>
  <main class="view" id="v-admin" hidden></main>
  <main class="view" id="v-control" hidden></main>
  <main class="view" id="v-customers" hidden></main>
  <main class="view" id="v-welcome" hidden></main>
  <main class="view" id="v-login" hidden></main>
  <div class="view" id="v-studio">
  <div class="notice" id="standalone" hidden>المنصة تحفظ المشاريع وتربط الأدوار عندما تُفتح داخل Claude بحسابك. المصمّم يعمل هنا بدون حفظ.</div>
  <section class="panel pbar" id="pbar" hidden aria-label="حالة المشروع"></section>
  <header id="studioIntro">
    <h1>استوديو التصميم</h1>""")
rep("""      </div>
    </section>
  </div>
</div>
""", """      </div>
    </section>
  </div>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
""")

# ---------------------------------------------------------------- hooks into the studio code
rep("const S = { photos: [], idea: '',", "const S = { project: null, photos: [], idea: '',")
rep("""    renderResult(refit);
    $('editForm').hidden = false;
  }""", """    renderResult(refit);
    $('editForm').hidden = false;
    afterDesign();
  }""")
rep("""    try { S.result = await build(S.design, overrides); S.inspection = null; renderResult(false); }""",
    """    try { S.result = await build(S.design, overrides); S.inspection = null; renderResult(false); afterDesign(); }""")
rep("""        const cost = Math.round((est.mass_g / 1000) * pricePerKg);""", """        const kg = PL.ready ? priceOf(est.material) : pricePerKg;
        const cost = Math.round((est.mass_g / 1000) * kg);""")
rep("""        p.append(el('label', { className: 'price' }, 'سعر كيلو ' + est.material + ' (د.ع):', inp));""",
    """        if (!PL.ready) p.append(el('label', { className: 'price' }, 'سعر كيلو ' + est.material + ' (د.ع):', inp));
        else p.append(el('p', { className: 'sub', textContent: `سعر الكيلو ${kg.toLocaleString('en')} د.ع من إعدادات المنصة.` }));""")
rep("  $('restart').onclick = () => {", "  $('restart').onclick = () => {")  # replaced by platform.js later (assignment order)
rep("التجميعات لا تُحفظ في مسار الاعتماد والطباعة بعد — نزّلها أو اعتمد كل قطعة كمشروع.", "احفظ التجميعة في المشروع وأرسلها للمراجعة: يعتمد المصمّم كل قطعة على حدة ثم التجميعة كاملة، وتُطبع القطع من ملفاتها المعتمدة.")
rep("  // ------------------------------------------------------------------ boot", "/*PLATFORM*/\n  // ------------------------------------------------------------------ boot")
rep("  window.__forma = { S, build, renderViews, finishDesign };", "  initPlatform();\n  window.__forma = { S, PL, build, renderViews, finishDesign };")

(here / "platform.template.html").write_text(s)
print("platform.template.html written")
