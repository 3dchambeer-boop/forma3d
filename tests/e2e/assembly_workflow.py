# Browser end-to-end (Playwright + Chromium) on the offline file built from this repository.
# Run: python3 tests/e2e/assembly_workflow.py   (needs playwright; the STEP test also needs forma_occ built and LD_LIBRARY_PATH set)
# Assembly through the platform workflow (offline file, real browser): per-component approval -> assembly approval
# -> print request -> queued job -> print files verified against the approved per-part SHA-256.
import os, pathlib, zipfile, hashlib, json
from playwright.sync_api import sync_playwright
import shutil, tempfile
REPO = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(tempfile.mkdtemp(prefix='forma-e2e-')); S = str(HERE) + '/'
shutil.copy(REPO / 'services/ai_3d_engine/browser/forma-offline.html', HERE / 'forma.html')
def btn(pg, name): pg.locator('button:visible', has_text=name).first.click()
def ev(pg, js): return pg.evaluate(js)
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(S + 'profile_asm', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'], viewport={'width': 1300, 'height': 1000}, accept_downloads=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((HERE / 'forma.html').as_uri()); pg.wait_for_timeout(800)
    # the offline file opens on the CMG welcome page; its main button leads to sign-in
    pg.wait_for_selector('.wl-cta', timeout=60000); pg.locator('.wl-cta').click(); pg.wait_for_timeout(500)
    pg.fill('#newName', 'حسين'); btn(pg, 'ابدأ'); pg.wait_for_timeout(1200)
    pg.select_option('#viewAs', 'operator'); pg.evaluate("location.hash='print'"); pg.wait_for_timeout(400)
    pg.click('details.adder summary'); pg.fill('#npName', 'Ender-3 A'); pg.locator('form.addprinter button').click(); pg.wait_for_timeout(600)
    pg.select_option('#viewAs', ''); pg.evaluate("location.hash='new'"); pg.wait_for_timeout(300)
    pg.locator('#asmStarters button').first.click()
    pg.wait_for_function("!document.getElementById('asmBox').hidden && window.__forma.PL.resultSha", timeout=240000); pg.wait_for_timeout(400)
    print('studio:', pg.locator('#status').inner_text(), '| bar:', pg.locator('#pbar .row').first.inner_text().replace('\n', ' / '))
    btn(pg, 'أرسل للمراجعة'); pg.wait_for_timeout(900)
    P = "window.__forma.PL.projects[0]"
    print('saved:', ev(pg, f"JSON.stringify({{kind:{P}.kind, status:{P}.status, rev:{P}.revision, parts:Object.keys({P}.partShas), sha:{P}.sha.slice(0,12), summary:{P}.summary.checks}})"))
    pg.select_option('#viewAs', 'designer'); pg.wait_for_timeout(400)
    ab = pg.locator('#pbar button', has_text='اعتمد التجميعة')
    print('designer: approve-assembly disabled before components:', ab.is_disabled(), '| components:', pg.locator('#pbar details.timeline summary').first.inner_text())
    pg.locator('#pbar button', has_text='اعتمد القطعة').first.click(); pg.wait_for_timeout(700)
    print('after 1st component:', pg.locator('#pbar details.timeline summary').first.inner_text(), '| still disabled:', pg.locator('#pbar button', has_text='اعتمد التجميعة').is_disabled())
    pg.locator('#pbar button', has_text='اعتمد القطعة').first.click(); pg.wait_for_timeout(700)
    print('after 2nd component:', pg.locator('#pbar details.timeline summary').first.inner_text(), '| enabled:', not pg.locator('#pbar button', has_text='اعتمد التجميعة').is_disabled())
    pg.locator('#pbar button', has_text='اعتمد التجميعة').click(); pg.wait_for_timeout(300)
    print('gate:', pg.locator('#pbar .gate').inner_text().replace('\n', ' | '))
    pg.locator('#pbar .subform button', has_text='اعتمد التجميعة').click(); pg.wait_for_timeout(900)
    print('approved:', ev(pg, f"JSON.stringify({{status:{P}.status, approvedRevision:{P}.approvedRevision, same:JSON.stringify({P}.approvedPartShas)===JSON.stringify({P}.partShas), approvals:Object.keys({P}.componentApprovals)}})"))
    pg.select_option('#viewAs', ''); pg.wait_for_timeout(300); btn(pg, 'اطلب الطباعة'); pg.wait_for_timeout(200)
    print('request form:', pg.locator('#pbar .subform').inner_text().replace('\n', ' | ')[:260])
    pg.fill('#prQty', '2'); pg.locator('.subform button', has_text='أرسل طلب الطباعة').click(); pg.wait_for_timeout(800)
    pg.select_option('#viewAs', 'operator'); pg.wait_for_timeout(300); btn(pg, 'اقبل وأضف للطابور'); pg.locator('.subform button', has_text='أضف للطابور').click(); pg.wait_for_timeout(900)
    job = json.loads(ev(pg, "JSON.stringify(window.__forma.PL.jobs[0])"))
    print('job parts:', [(x['id'], x['qty'], x['material'], x['approvedSha'][:10]) for x in job['parts']])
    pg.evaluate("location.hash='print'"); pg.wait_for_timeout(600)
    print('job card:', pg.locator('article.job').first.inner_text().replace('\n', ' | ')[:240])
    with pg.expect_download(timeout=240000) as dl: btn(pg, 'تنزيل ملفات الطباعة')
    dl.value.save_as(S + 'asmjob.zip'); pg.wait_for_timeout(600)
    z = zipfile.ZipFile(S + 'asmjob.zip'); names = z.namelist(); print('ZIP:', names)
    approved = json.loads(ev(pg, f"JSON.stringify({P}.approvedPartShas)"))
    for x in job['parts']:
        f = [n for n in names if n.endswith('-' + x['id'] + '.stl')][0]
        print('  ', x['id'], 'file sha == approved part sha:', hashlib.sha256(z.read(f)).hexdigest() == approved[x['id']] == x['approvedSha'])
    print('SHEET:', z.read('print-sheet.txt').decode().split('\n')[:4])
    # reload: the project is rebuilt from its source and must reproduce the recorded hash
    pg.reload(); pg.wait_for_timeout(1200)
    pid = ev(pg, f"{P}.id"); pg.evaluate(f"location.hash='project-{pid}'")
    pg.wait_for_function("window.__forma.PL.resultSha", timeout=240000); pg.wait_for_timeout(500)
    print('after reload: rebuilt sha == recorded:', ev(pg, f"window.__forma.PL.resultSha==={P}.sha"), '| status', ev(pg, f"{P}.status"))
    print('log:', ev(pg, f"{P}.events.map(e=>e.type).join(',')"))
    pg.set_viewport_size({'width': 390, 'height': 900}); pg.wait_for_timeout(300); print('mobile hscroll:', ev(pg, 'document.documentElement.scrollWidth>innerWidth'))
    pg.screenshot(path=S + 'asm_bar.png', full_page=False)
    print('page errors:', errs)
    ctx.close()
