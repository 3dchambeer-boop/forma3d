"""Assemble the self-contained designer page: engine + CAD language + agents inlined."""
from pathlib import Path

here = Path(__file__).parent
lib = "\n".join((here / f).read_text() for f in ("engine.js", "analysis.js", "cad.js", "exporters.js", "drawing.js", "calibration.js", "concepts.js", "assembly.js", "commerce.js", "archive.js", "site.js", "versions.js", "agents.js", "viewer.js", "starters.js", "local.js"))
assert "</script" not in lib.lower()
# third-party code kept out of the build worker: pdf-lib (MIT, vendored; licence in vendor/)
vendor = (here / "vendor" / "pdf-lib.min.js").read_text()
# pdf-lib has literal U+FFFD characters inside string literals; the escape is the same JS value and keeps the page clean
vendor = vendor.replace("\ufffd", "\\uFFFD")
assert "\ufffd" not in vendor
assert "</script" not in vendor.lower()
page = (here / "designer.template.html").read_text().replace("/*LIB*/", lib).replace("/*VENDOR*/", vendor)
(here / "designer.html").write_text(page)
studio = (here / "studio.template.html").read_text().replace("/*ENGINE*/", (here / "engine.js").read_text())
(here / "studio.html").write_text(studio)
print(f"designer.html {len(page) // 1024} KB")
platform = (here / "platform.template.html").read_text().replace("/*LIB*/", lib).replace("/*VENDOR*/", vendor).replace("/*PLATFORM*/", (here / "platform.js").read_text())
(here / "platform.html").write_text(platform)
print(f"platform.html {len(platform) // 1024} KB")

# Offline single file: the same platform wrapped in a full HTML document (no claude.ai runtime needed).
skeleton = ('<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            '<meta name="color-scheme" content="light dark">\n</head>\n<body>\n')
import re as _re
_title = _re.search(r'<title>.*?</title>', platform).group(0)
offline = skeleton.replace('</head>', _title + '\n</head>') + platform.replace(_title, '', 1).replace('<meta name="claude:viewport-fit-sides" content="cover">', '', 1) + '\n</body>\n</html>\n'
assert 'https://' not in offline.replace('https?:', '').split('<script id="lib">')[0], 'external resource in page head/markup'
(here / "forma-offline.html").write_text(offline)
print(f"forma-offline.html {len(offline) // 1024} KB")
