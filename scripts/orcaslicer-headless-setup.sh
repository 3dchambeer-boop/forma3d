#!/usr/bin/env bash
# Install the OrcaSlicer CLI on a Linux server without a desktop, and flatten the Ender-3 presets.
#   scripts/orcaslicer-headless-setup.sh /opt/orcaslicer        (needs curl, gcc, node)
# Then: ORCASLICER_BIN=/opt/orcaslicer/orca-headless  ORCASLICER_PROFILE_DIR=/opt/orcaslicer/presets
# The AppImage links the GTK web view (webkit2gtk-4.0) for its GUI; the CLI never calls it, so two stub
# libraries with the same sonames satisfy the dynamic loader. On a desktop install use the real binary instead.
set -euo pipefail
DEST="${1:-/opt/orcaslicer}"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
VERSION="${ORCA_VERSION:-v2.1.1}"
mkdir -p "$DEST/stubs" && cd "$DEST"
[ -f orca.AppImage ] || curl -fL -o orca.AppImage "https://github.com/SoftFever/OrcaSlicer/releases/download/${VERSION}/OrcaSlicer_Linux_${VERSION^}.AppImage"
chmod +x orca.AppImage
[ -d squashfs-root ] || ./orca.AppImage --appimage-extract >/dev/null
BIN=squashfs-root/bin/orca-slicer
for pair in "jsc:libjavascriptcoregtk-4.0.so.18:JS[A-Z]|jsc_" "wk:libwebkit2gtk-4.0.so.37:webkit_"; do
  IFS=: read -r name soname pattern <<<"$pair"
  { echo "/* headless stub */"; nm -D --undefined-only "$BIN" | awk '{print $2}' | grep -E "^($pattern)" | sort -u | sed 's/.*/void* &(void){return 0;}/'; } > "stubs/$name.c"
  gcc -shared -fPIC -o "stubs/$soname" -Wl,-soname,"$soname" "stubs/$name.c"
done
cat > orca-headless <<'SH'
#!/bin/sh
DIR="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$DIR/stubs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$DIR/squashfs-root/bin/orca-slicer" "$@"
SH
chmod +x orca-headless
missing=$(LD_LIBRARY_PATH="$DEST/stubs" ldd "$BIN" | grep "not found" || true)
[ -z "$missing" ] || { echo "still missing: $missing" >&2; exit 1; }
node "$SCRIPTS/orca-flatten-presets.mjs" squashfs-root/resources/profiles presets \
  --machine "Creality Ender-3 0.4 nozzle" --process "0.20mm Standard @Creality Ender3 0.4" \
  --filament "Creality Generic PLA" --filament "Creality Generic PETG"
./orca-headless --help >/dev/null 2>&1 && echo "OrcaSlicer CLI ready: ORCASLICER_BIN=$DEST/orca-headless ORCASLICER_PROFILE_DIR=$DEST/presets"
