# Browser end-to-end (Playwright + Chromium) on the offline file built from this repository.
# Run: python3 tests/e2e/step_real_kernel.py   (needs playwright; the STEP test also needs forma_occ built and LD_LIBRARY_PATH set)
# End to end with the REAL OpenCascade kernel: browser STEP button -> stdlib HTTP service -> forma_occ (OCCT 7.8.1)
import os, pathlib, subprocess, time, re, urllib.request, json
from playwright.sync_api import sync_playwright
import shutil, tempfile
REPO = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(tempfile.mkdtemp(prefix='forma-e2e-')); S = str(HERE) + '/'
shutil.copy(REPO / 'services/ai_3d_engine/browser/forma-offline.html', HERE / 'forma.html')
env = dict(os.environ, CAD_SERVICE_TOKEN='e2e-token-9f2c', CAD_ALLOWED_ORIGINS='null', LD_LIBRARY_PATH=os.environ.get('LD_LIBRARY_PATH', ''))
srv = subprocess.Popen(['python3', '-m', 'cad_engine', 'serve-stdlib', '--port', '18766'], cwd=str(REPO / 'services/cad_engine'), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
for _ in range(50):
    try: print('HEALTH:', urllib.request.urlopen('http://127.0.0.1:18766/v1/cad/health').read().decode()); break
    except Exception: time.sleep(0.2)
def btn(pg, name): pg.locator('button:visible', has_text=name).first.click()
try:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(S + 'profile', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'], viewport={'width': 1300, 'height': 1000}, accept_downloads=True)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: print('CONSOLE:', m.text[:300]) if m.type == 'error' else None)
        pg.goto((HERE / 'forma.html').as_uri()); pg.wait_for_timeout(800)
        # the offline file opens on the CMG welcome page; its main button leads to sign-in
        pg.wait_for_selector('.wl-cta', timeout=60000); pg.locator('.wl-cta').click(); pg.wait_for_timeout(500)
        if pg.locator('#newName').count() and pg.locator('#newName').is_visible():
            pg.fill('#newName', 'حسين'); btn(pg, 'ابدأ'); pg.wait_for_timeout(1200)
        pg.evaluate("location.hash='new'"); pg.wait_for_timeout(300)
        pg.locator('#starters button', has_text='أردوينو').first.click(); pg.wait_for_function("document.getElementById('status').hidden===false", timeout=90000); pg.wait_for_timeout(500)
        btn(pg, 'الرسم الهندسي والملفات'); pg.wait_for_timeout(300)
        pg.fill('input[type=url]', 'http://127.0.0.1:18766')
        pg.fill('input[type=password]', 'wrong-token'); btn(pg, 'تصدير STEP'); pg.wait_for_timeout(2500)
        print('WRONG TOKEN:', pg.locator('.drwbox .thinking').inner_text())
        pg.fill('input[type=password]', 'e2e-token-9f2c')
        t0 = time.time()
        with pg.expect_download(timeout=180000) as d: btn(pg, 'تصدير STEP')
        d.value.save_as(S + 'case.step'); pg.wait_for_timeout(300)
        print('STEP OK: %s %d bytes in %.1fs | %s' % (d.value.suggested_filename, os.path.getsize(S + 'case.step'), time.time() - t0, pg.locator('.drwbox .thinking').inner_text()))
        txt = open(S + 'case.step', errors='replace').read()
        print('STEP header:', txt[:13], '| schema:', re.search(r"FILE_SCHEMA\s*\(\s*\('([^']+)", txt).group(1), '| ADVANCED_FACE:', txt.count('ADVANCED_FACE('), '| MANIFOLD_SOLID_BREP:', txt.count('MANIFOLD_SOLID_BREP('))
        print('page errors:', errs)
        ctx.close()
finally:
    srv.terminate(); out = srv.communicate(timeout=5)[0].decode(); print('SERVICE LOG:', ' || '.join(out.strip().splitlines()[-4:]))
