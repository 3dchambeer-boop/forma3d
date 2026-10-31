#!/usr/bin/env bash
# Build OpenCascade 7.8.1 from source (only the toolkits FormaCAD needs) and the forma_occ executor.
# This is exactly how the Phase 9 kernel tests were run: no conda, no pip, no system OCCT package.
#
#   scripts/build-occt-native.sh [work-dir]          (default work dir: ./.occt)
#
# Needs: git, cmake >= 3.16, ninja, a C++17 compiler, libfreetype-dev. About 25 min on 2 cores.
# Afterwards:
#   export FORMA_OCC_BIN=<repo>/services/cad_engine/native/build/forma_occ
#   export LD_LIBRARY_PATH=<work-dir>/build/lin64/gcc/lib
#   cd services/cad_engine && python3 -m pytest -q tests/test_native.py
# OCCT licence: LGPL-2.1 with the Open CASCADE exception (dynamic linking; the source is not modified).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mkdir -p "${1:-$ROOT/.occt}" && cd "${1:-$ROOT/.occt}" && pwd)
TAG=V7_8_1

if [ ! -d "$WORK/occt" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/Open-Cascade-SAS/OCCT.git "$WORK/occt"
fi
cmake -S "$WORK/occt" -B "$WORK/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_LIBRARY_TYPE=Shared \
  -DBUILD_MODULE_Draw=OFF -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_ApplicationFramework=ON -DBUILD_MODULE_DataExchange=ON \
  -DUSE_FREETYPE=ON -DUSE_TK=OFF -DUSE_OPENGL=OFF -DUSE_FREEIMAGE=OFF -DUSE_FFMPEG=OFF -DUSE_DRACO=OFF -DUSE_VTK=OFF

# Some toolkits still name GL/EGL at link time even with OpenGL off. On machines that only have the versioned
# runtime libraries (libGL.so.1) give the linker unversioned names; nothing from them is used.
LINKS="$WORK/gl-links"; mkdir -p "$LINKS"
for l in GL EGL; do
  if ! ldconfig -p 2>/dev/null | grep -q "lib$l.so " ; then
    so=$(ldconfig -p 2>/dev/null | awk -v n="lib$l.so.1" '$1==n {print $NF; exit}')
    [ -n "$so" ] && ln -sf "$so" "$LINKS/lib$l.so"
  fi
done
export LIBRARY_PATH="$LINKS${LIBRARY_PATH:+:$LIBRARY_PATH}"

ninja -C "$WORK/build" TKDESTEP TKDESTL TKFillet TKOffset TKFeat TKMesh TKBO TKBool TKShHealing

N="$ROOT/services/cad_engine/native"
cmake -S "$N" -B "$N/build" -G Ninja -DOCCT_INCLUDE_DIR="$WORK/build/include/opencascade" -DOCCT_LIBRARY_DIR="$WORK/build/lin64/gcc/lib"
cmake --build "$N/build"
echo
echo "forma_occ: $N/build/forma_occ"
echo "export LD_LIBRARY_PATH=$WORK/build/lin64/gcc/lib"
