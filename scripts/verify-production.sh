#!/usr/bin/env bash
# Production gate: every check that must pass before a release. Prints PASS / FAIL / SKIP (with the reason) per step.
#   scripts/verify-production.sh            run what this machine can run; missing tools are SKIP
#   scripts/verify-production.sh --strict   (CI) any SKIP is a failure: nothing may be left unverified
# Optional real-kernel steps: FORMA_OCC_BIN (+ LD_LIBRARY_PATH) for OpenCascade, ORCASLICER_BIN/ORCASLICER_PROFILE_DIR for slicing.
set -uo pipefail
cd "$(dirname "$0")/.."
STRICT=0; [ "${1:-}" = "--strict" ] && STRICT=1
PASS=(); FAIL=(); SKIP=()
LOG=$(mktemp -d)
step() { # step <name> <command...>
  local name=$1; shift
  if "$@" >"$LOG/$name.log" 2>&1; then PASS+=("$name"); echo "PASS  $name"
  else FAIL+=("$name"); echo "FAIL  $name   (log: $LOG/$name.log)"; tail -n 15 "$LOG/$name.log" | sed 's/^/      /'; fi
}
skip() { SKIP+=("$1: $2"); echo "SKIP  $1   ($2)"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---- 1. secrets never committed
secret_scan() {
  git ls-files -z | xargs -0 grep -nIE \
    -e 'sk-ant-[A-Za-z0-9_-]{20,}' -e 'tsk_[A-Za-z0-9_-]{20,}' -e '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' \
    -e 'AKIA[0-9A-Z]{16}' -e 'EAA[A-Za-z0-9]{60,}' -- ':!scripts/verify-production.sh' && return 1
  git ls-files | grep -E '(^|/)\.env$' && return 1
  return 0
}
step secret-scan secret_scan

# ---- 2. JavaScript toolchain: install, Prisma, typecheck, lint, build
PM=""; have bun && PM=bun; [ -z "$PM" ] && have npm && PM=npm
if [ -n "$PM" ] && { [ -d node_modules/next ] || { [ "$PM" = bun ] && bun install --frozen-lockfile >"$LOG/install.log" 2>&1; } || { [ "$PM" = npm ] && npm ci >"$LOG/install.log" 2>&1; }; } && [ -d node_modules/next ]; then
  PX="npx"; [ "$PM" = bun ] && PX="bunx"
  step prisma-validate $PX prisma validate
  step prisma-generate $PX prisma generate
  # the schema applies to an empty database (db push mode: there is no migrations folder yet)
  step prisma-apply-empty-db env DATABASE_URL="file:$LOG/verify.db" $PX prisma db push --skip-generate --accept-data-loss
  step typecheck-app $PX tsc --noEmit -p tsconfig.json
  step lint $PM run lint
  step next-build $PM run build
  if [ -f .next/standalone/server.js ]; then
    smoke() {
      local db="$LOG/smoke.db"; DATABASE_URL="file:$db" $PX prisma db push --skip-generate >/dev/null 2>&1 || return 1
      (cd .next/standalone && PORT=3111 DATABASE_URL="file:$db" SESSION_SECRET="$(head -c 32 /dev/urandom | base64)" DOWNLOAD_SIGNING_SECRET="$(head -c 32 /dev/urandom | base64)" node server.js >"$LOG/server.log" 2>&1 & echo $! >"$LOG/server.pid")
      for _ in $(seq 60); do curl -fs http://127.0.0.1:3111/api/health >/dev/null && break; sleep 1; done
      curl -fs http://127.0.0.1:3111/api/health | grep -q '"status"' || { kill "$(cat "$LOG/server.pid")"; return 1; }
      # unauthenticated requests to protected routes must be refused
      local bad=0
      for r in "GET /api/analytics/ai-usage" "POST /api/payments/x/refund" "GET /api/users" "GET /api/projects" "POST /api/cad/import" "POST /api/auth/mfa/setup"; do
        set -- $r; c=$(curl -s -o /dev/null -w '%{http_code}' -X "$1" "http://127.0.0.1:3111$2")
        [ "$c" = 401 ] || [ "$c" = 403 ] || { echo "$1 $2 -> $c (expected 401/403)"; bad=1; }
      done
      kill "$(cat "$LOG/server.pid")"; return $bad
    }
    step smoke-health-and-unauthorized smoke
  else skip smoke-health-and-unauthorized "no standalone build"; fi
else
  for s in prisma-validate prisma-generate prisma-apply-empty-db typecheck-app lint next-build smoke-health-and-unauthorized; do skip "$s" "node_modules could not be installed (no package registry access?)"; done
fi

# ---- 3. tests that need no app dependencies
if have node; then
  step node-tests node --import tsx --no-warnings --test tests/node/*.test.ts
  if have tsc || [ -x node_modules/.bin/tsc ]; then step typecheck-libraries "$(have tsc && echo tsc || echo node_modules/.bin/tsc)" -p tests/node/tsconfig.json
  else skip typecheck-libraries "no tsc"; fi
else skip node-tests "no node"; fi
if have python3; then
  step python-engine-tests bash -c 'cd services/ai_3d_engine && python3 -m pytest -q'
  step python-cad-tests bash -c 'cd services/cad_engine && python3 -m pytest -q'
  step ops-tests python3 -m pytest -q tests/ops
  if [ -n "${FORMA_OCC_BIN:-}" ] || [ -x services/cad_engine/native/build/forma_occ ]; then
    # must pass AND run every test (a skip here means the kernel was not actually used)
    step opencascade-real-kernel bash -c 'cd services/cad_engine && python3 -m pytest -q -rs tests/test_native.py >/tmp/occ.$$ 2>&1; rc=$?; cat /tmp/occ.$$; ! grep -q SKIPPED /tmp/occ.$$ && [ $rc -eq 0 ]'
  else skip opencascade-real-kernel "forma_occ not built (scripts/build-occt-native.sh)"; fi
else skip python-tests "no python3"; fi
if [ -n "${ORCASLICER_BIN:-}" ]; then step orcaslicer-real node --import tsx --no-warnings --test tests/node/orcaslicer-real.test.ts
else skip orcaslicer-real "ORCASLICER_BIN not set (scripts/orcaslicer-headless-setup.sh)"; fi

# ---- 4. deployment files
if have docker && docker compose version >/dev/null 2>&1; then
  step compose-config env ENGINE_SERVICE_TOKEN=verify CAD_SERVICE_TOKEN=verify docker compose --env-file /dev/null config -q
  compose_requires_secrets() { ! docker compose --env-file /dev/null config -q 2>/dev/null; }
  step compose-refuses-missing-secrets compose_requires_secrets
else skip compose-config "no docker compose"; fi

echo
echo "passed ${#PASS[@]}, failed ${#FAIL[@]}, skipped ${#SKIP[@]}"
for s in "${SKIP[@]}"; do echo "  skipped: $s"; done
[ ${#FAIL[@]} -eq 0 ] || exit 1
[ $STRICT -eq 1 ] && [ ${#SKIP[@]} -gt 0 ] && { echo "strict mode: skipped steps count as failures"; exit 2; }
exit 0
