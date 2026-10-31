# OpenCascade CAD service: OCCT 7.8.1 built from source + the forma_occ executor + the stdlib HTTP API.
# The build steps are the ones scripts/build-occt-native.sh ran for the Phase 9 kernel tests (55 tests on OCCT 7.8.1);
# this image itself has not been built in the authoring environment (no Docker daemon or registry there).
#   docker compose build cad        (from the repository root; the context is the repository)

FROM debian:bookworm-slim AS occt
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git cmake ninja-build g++ libfreetype-dev libfontconfig-dev libgl-dev libegl-dev \
    && rm -rf /var/lib/apt/lists/*
# libgl-dev/libegl-dev: some OCCT toolkits name GL at link time even with OpenGL off; forma_occ does not load them
WORKDIR /src
RUN git clone --depth 1 --branch V7_8_1 https://github.com/Open-Cascade-SAS/OCCT.git occt
RUN cmake -S occt -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_LIBRARY_TYPE=Shared \
      -DBUILD_MODULE_Draw=OFF -DBUILD_MODULE_Visualization=OFF -DBUILD_MODULE_ApplicationFramework=ON -DBUILD_MODULE_DataExchange=ON \
      -DUSE_FREETYPE=ON -DUSE_TK=OFF -DUSE_OPENGL=OFF -DUSE_FREEIMAGE=OFF -DUSE_FFMPEG=OFF -DUSE_DRACO=OFF -DUSE_VTK=OFF \
 && ninja -C build TKDESTEP TKDESTL TKFillet TKOffset TKFeat TKMesh TKBO TKBool TKShHealing
COPY services/cad_engine/native /src/native
RUN cmake -S native -B native/build -G Ninja -DOCCT_INCLUDE_DIR=/src/build/include/opencascade -DOCCT_LIBRARY_DIR=/src/build/lin64/gcc/lib \
 && cmake --build native/build \
 && mkdir -p /out/lib && cp -a build/lin64/gcc/lib/*.so* /out/lib/ && cp native/build/forma_occ /out/

FROM python:3.12-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends libfreetype6 libfontconfig1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app cad
COPY --from=occt /out/lib /opt/occt/lib
COPY --from=occt /out/forma_occ /opt/occt/bin/forma_occ
COPY services/cad_engine/cad_engine /app/cad_engine
ENV LD_LIBRARY_PATH=/opt/occt/lib FORMA_OCC_BIN=/opt/occt/bin/forma_occ CAD_KERNEL=native PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
USER cad
EXPOSE 8200
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8200/v1/cad/health', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "cad_engine", "serve-stdlib", "--host", "0.0.0.0", "--port", "8200"]
