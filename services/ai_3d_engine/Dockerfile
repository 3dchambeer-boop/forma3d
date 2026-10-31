# ai_3d_engine — internal geometry service (not exposed to the internet)
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    ENGINE_ARTIFACT_DIR=/var/lib/ai_3d_engine/artifacts
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ai_3d_engine ./ai_3d_engine
# unprivileged user; artifacts are the only writable path
RUN useradd --system --uid 10001 --home /nonexistent engine \
 && mkdir -p /var/lib/ai_3d_engine/artifacts \
 && chown -R engine /var/lib/ai_3d_engine
USER engine
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8100/healthz',timeout=3)"
CMD ["uvicorn", "ai_3d_engine.app:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]

FROM base AS test
USER root
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY tests ./tests
COPY pytest.ini .
USER engine
CMD ["python", "-m", "pytest", "-q"]
