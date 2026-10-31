# Browser end-to-end (Playwright + Chromium) on the offline platform: Customer Intelligence & Project Archive,
# Executive Control Center, global search and account suspension — with real local accounts and records.
import os, pathlib, shutil, tempfile, json
from playwright.sync_api import sync_playwright
REPO = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(tempfile.mkdtemp(prefix='forma-e2e-')); S = str(HERE) + '/'
shutil.copy(REPO / 'services/ai_3d_engine/browser/forma-offline.html', HERE / 'forma.html')
def btn(pg, name): pg.locator('button:visible', has_text=name).first.click()
def past_welcome(pg):  # after a reload the offline file shows the welcome page first
    pg.wait_for_timeout(800)
    if pg.locator('.wl-cta').count() and pg.locator('.wl-cta').is_visible(): pg.locator('.wl-cta').click(); pg.wait_for_timeout(500)
def login_new(pg, name, pin):
    pg.fill('#newName', name); pg.fill('#newPin', pin); pg.locator('form', has=pg.locator('#newName')).locator('button[type=submit]').click(); pg.wait_for_timeout(1200)
def switch_to(pg, name, pin):
    btn(pg, 'تبديل المستخدم'); past_welcome(pg)
    pg.locator('button.account', has_text=name).click(); pg.fill('#loginPin', pin); btn(pg, 'دخول'); pg.wait_for_timeout(1200)
def starter(pg, text):
    pg.evaluate("location.hash='new'"); pg.wait_for_timeout(300)
    pg.locator('#starters button', has_text=text).first.click(); pg.wait_for_function("document.getElementById('status').hidden===false", timeout=90000); pg.wait_for_timeout(600)
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(S + 'profile', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'], viewport={'width': 1300, 'height': 1000}, accept_downloads=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((HERE / 'forma.html').as_uri()); pg.wait_for_timeout(800)
    # the offline file opens on the CMG welcome page; its main button leads to sign-in
    pg.wait_for_selector('.wl-cta', timeout=60000); pg.locator('.wl-cta').click(); pg.wait_for_timeout(500)
    login_new(pg, 'المدير', '1234')
    btn(pg, 'تبديل المستخدم'); past_welcome(pg)
    print('sign-up form offers:', pg.locator('label[for=newName]').inner_text())
    login_new(pg, 'سارة أحمد', '5678')
    starter(pg, 'مفتاح صامولة'); btn(pg, 'أرسل للمراجعة'); pg.wait_for_timeout(900)
    starter(pg, 'أردوينو'); btn(pg, 'احفظ كمسودة'); pg.wait_for_timeout(900)
    switch_to(pg, 'المدير', '1234')
    sara = pg.evaluate("window.__forma.PL.projects.find(p=>p.title.includes('مفتاح')).ownerId")
    # designer approves the wrench
    pg.select_option('#viewAs', 'designer'); pg.evaluate(f"location.hash='project-'+window.__forma.PL.projects.find(p=>p.title.includes('مفتاح')).id"); pg.wait_for_timeout(2500)
    btn(pg, 'اعتمد التصميم'); pg.locator('.subform button', has_text='اعتمد').first.click(); pg.wait_for_timeout(900)
    pg.select_option('#viewAs', ''); pg.wait_for_timeout(300)
    # control center
    pg.evaluate("location.hash='control'"); pg.wait_for_timeout(700)
    print('CONTROL:', ' | '.join(x.inner_text().replace('\n', ' ') for x in pg.locator('#v-control .stat').all()[:4]))
    print('PIPELINE:', pg.locator('#v-control .bpipe').inner_text().replace('\n', ' ')[:200])
    with pg.expect_download() as d: btn(pg, 'المشاريع (CSV)')
    d.value.save_as(S + 'projects.csv'); csv = open(S + 'projects.csv', encoding='utf-8-sig').read().splitlines(); print('CSV rows:', len(csv) - 1, '| header:', csv[0])
    # directory → profile → archive
    pg.evaluate("location.hash='customers'"); pg.wait_for_timeout(700)
    cards = pg.locator('.custcard'); print('DIRECTORY cards:', cards.count(), '|', cards.first.inner_text().replace('\n', ' ')[:160])
    pg.fill('#dirQ', 'لا يوجد'); pg.wait_for_timeout(200); print('search no match:', pg.locator('#v-customers .empty').inner_text())
    pg.fill('#dirQ', 'سارة'); pg.wait_for_timeout(200); pg.locator('.custcard').first.click(); pg.wait_for_timeout(700)
    print('PROFILE groups:', [x.inner_text().replace('\n', ' ') for x in pg.locator('#v-customers h3').all()])
    pg.locator('.projcard', has_text='مفتاح').click(); pg.wait_for_timeout(700)
    tl = pg.locator('.ptimeline li'); print('TIMELINE:', tl.count(), 'events |', ' / '.join(x.inner_text().split('\n')[1] for x in tl.all()))
    print('source refs:', pg.locator('.ptimeline small').first.inner_text())
    btn(pg, 'أرشف المشروع'); pg.wait_for_timeout(800)
    print('after archive:', pg.evaluate("JSON.stringify((({archived,events})=>({archived:!!archived,last:events.at(-1).type}))(window.__forma.PL.projects.find(p=>p.title.includes('مفتاح'))))"))
    # global search (Ctrl+K)
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(200); pg.fill('#paletteQ', 'سارة'); pg.wait_for_timeout(200)
    print('PALETTE:', [x.inner_text().replace('\n', ' ') for x in pg.locator('#paletteList li').all()])
    pg.keyboard.press('Enter'); pg.wait_for_timeout(600); print('palette navigated to:', pg.evaluate('location.hash'))
    # suspend with a reason, audited
    btn(pg, 'أوقف الحساب'); pg.wait_for_timeout(300); print('no reason:', pg.locator('.toast').inner_text())
    pg.fill('#accReason', 'طلب الزبون إيقاف الحساب مؤقتًا'); btn(pg, 'أوقف الحساب'); pg.wait_for_timeout(900)
    pg.fill('#accNote', 'تواصلت هاتفيًا؛ تعود الشهر القادم'); btn(pg, 'أضف الملاحظة'); pg.wait_for_timeout(900)
    print('ACCOUNT:', pg.evaluate(f"JSON.stringify((({{status,notes,audit}})=>({{status,notes:notes.length,audit:audit.map(a=>a.action)}}))(window.__forma.PL.accounts['{sara}']))"))
    pg.set_viewport_size({'width': 390, 'height': 900}); pg.wait_for_timeout(300)
    print('mobile hscroll (profile):', pg.evaluate('document.documentElement.scrollWidth>innerWidth'))
    pg.screenshot(path=S + 'profile_mobile.png', full_page=False)
    pg.set_viewport_size({'width': 1300, 'height': 1000}); pg.evaluate("location.hash='customers'"); pg.wait_for_timeout(500); pg.screenshot(path=S + 'directory.png')
    pg.evaluate("location.hash='control'"); pg.wait_for_timeout(500); pg.screenshot(path=S + 'control.png', full_page=True)
    # the suspended customer: read-only, told why
    switch_to(pg, 'سارة أحمد', '5678')
    print('SUSPENDED view:', pg.locator('#who .pill').all_inner_texts(), '| canWrite:', pg.evaluate('window.__forma.PL.canWrite'), '| customer sees archive nav:', pg.locator('#nav a[href="#customers"]').count())
    pg.evaluate("location.hash='customers'"); pg.wait_for_timeout(400); print('customer opening #customers:', pg.locator('#v-customers').inner_text()[:40])
    print('artifacts:', S, '| page errors:', errs)
    ctx.close()
