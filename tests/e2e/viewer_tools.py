# Browser end-to-end (Playwright + Chromium, SwiftShader WebGL) for the studio's 3D viewer tools on the offline file:
# section clipping (cut faces drawn in the cut colour), wireframe, orthographic projection, reset.
# Pixels are counted from screenshots of the viewer, so the result reflects what is actually drawn.
import io, os, pathlib, shutil, tempfile
from PIL import Image
from playwright.sync_api import sync_playwright
REPO = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(tempfile.mkdtemp(prefix='forma-e2e-')); S = str(HERE) + '/'
shutil.copy(REPO / 'services/ai_3d_engine/browser/forma-offline.html', HERE / 'forma.html')
def btn(pg, name): pg.locator('button:visible', has_text=name).first.click()
def cut_pixels(png):  # pixels close to the cut colour (0.80, 0.33, 0.28)
    im = Image.open(io.BytesIO(png)).convert('RGB'); n = 0
    for r, g, b in im.get_flattened_data():
        if abs(r - 204) < 18 and abs(g - 84) < 18 and abs(b - 71) < 18: n += 1
    return n
def changed_pixels(a, b):  # pixels that differ visibly between two screenshots of the same size
    A, B = Image.open(io.BytesIO(a)).convert('RGB'), Image.open(io.BytesIO(b)).convert('RGB')
    return sum(1 for p, q in zip(A.get_flattened_data(), B.get_flattened_data()) if sum(abs(x - y) for x, y in zip(p, q)) > 30)
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(S + 'profile', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'], viewport={'width': 1300, 'height': 1000})
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((HERE / 'forma.html').as_uri()); pg.wait_for_timeout(800)
    # the offline file opens on the CMG welcome page; its main button leads to sign-in
    pg.wait_for_selector('.wl-cta', timeout=60000); pg.locator('.wl-cta').click(); pg.wait_for_timeout(500)
    if pg.locator('#newName').count() and pg.locator('#newName').is_visible():
        pg.fill('#newName', 'حسين'); btn(pg, 'ابدأ'); pg.wait_for_timeout(1200)
    pg.evaluate("location.hash='new'"); pg.wait_for_timeout(300)
    pg.locator('#starters button', has_text='أردوينو').first.click(); pg.wait_for_function("document.getElementById('status').hidden===false", timeout=90000); pg.wait_for_timeout(800)
    shot = lambda: pg.locator('#viewer canvas').screenshot()
    base = shot(); print('cut-colour pixels, no section:', cut_pixels(base))
    btn(pg, 'مقطع'); pg.wait_for_timeout(200); btn(pg, 'مقطع'); pg.wait_for_timeout(200); btn(pg, 'مقطع'); pg.wait_for_timeout(400)  # Z
    pg.fill('#secPos', '600'); pg.dispatch_event('#secPos', 'input'); pg.wait_for_timeout(400)
    sec = shot(); print('section:', pg.inner_text('#secLbl'), '| cut-colour pixels:', cut_pixels(sec))
    pg.screenshot(path=S + 'section.png')
    btn(pg, 'شبكة سلكية'); pg.wait_for_timeout(400)
    wire = shot(); open(S + 'wire.png', 'wb').write(wire); open(S + 'sec_view.png', 'wb').write(sec); print('wireframe: pixels changed by the edges:', changed_pixels(sec, wire))
    btn(pg, 'إسقاط متعامد'); pg.wait_for_timeout(400); ortho = shot()
    print('ortho changes the image:', ortho != wire, '| pressed:', pg.get_attribute('#orthoBtn', 'aria-pressed'))
    btn(pg, 'إعادة العرض'); pg.wait_for_timeout(400); reset = shot()
    print('after reset cut pixels:', cut_pixels(reset), '| section box hidden:', pg.is_hidden('#secBox'), '| wire pressed:', pg.get_attribute('#wireBtn', 'aria-pressed'))
    pg.set_viewport_size({'width': 390, 'height': 900}); pg.wait_for_timeout(300); print('mobile hscroll:', pg.evaluate('document.documentElement.scrollWidth>innerWidth'))
    print('artifacts:', S, '| page errors:', errs)
    ctx.close()
