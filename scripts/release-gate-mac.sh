#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Force deterministic test-server behavior. In particular, Playwright must not
# reuse an unrelated process already listening on the configured E2E ports.
export CI=true

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: release-gate-mac.sh must run on macOS." >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required." >&2
  exit 2
fi

START_HEAD="$(git rev-parse HEAD)"
START_BRANCH="$(git branch --show-current 2>/dev/null || true)"
START_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${START_HEAD:0:12}"
EVIDENCE_ROOT="${RELEASE_EVIDENCE_DIR:-$ROOT/.release-evidence}"
EVIDENCE_DIR="$EVIDENCE_ROOT/$RUN_ID"
LOG_FILE="$EVIDENCE_DIR/release-gate.log"
SUMMARY_FILE="$EVIDENCE_DIR/summary.txt"
SOAK_SECONDS="${RELEASE_GATE_SOAK_SECONDS:-60}"
ALLOW_DIRTY="${RELEASE_GATE_ALLOW_DIRTY:-0}"
RELEASE_ELIGIBLE=1

if ! [[ "$SOAK_SECONDS" =~ ^[0-9]+$ ]] || [ "$SOAK_SECONDS" -lt 1 ] || [ "$SOAK_SECONDS" -gt 86400 ]; then
  echo "ERROR: RELEASE_GATE_SOAK_SECONDS must be an integer from 1 to 86400." >&2
  exit 2
fi
if [ "$ALLOW_DIRTY" != "0" ] && [ "$ALLOW_DIRTY" != "1" ]; then
  echo "ERROR: RELEASE_GATE_ALLOW_DIRTY must be 0 or 1." >&2
  exit 2
fi
if [ "$ALLOW_DIRTY" = "1" ]; then
  RELEASE_ELIGIBLE=0
fi

mkdir -p "$EVIDENCE_DIR"

STATUS="FAIL"
CURRENT_STEP="initialization"

finish() {
  rc=$?
  trap - EXIT
  END_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  END_HEAD="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  {
    echo "product=Modbus Engineering Workbench"
    echo "release=8.0.0"
    echo "status=$STATUS"
    echo "exit_code=$rc"
    echo "start_utc=$START_UTC"
    echo "end_utc=$END_UTC"
    echo "branch=$START_BRANCH"
    echo "start_head=$START_HEAD"
    echo "end_head=$END_HEAD"
    echo "host_os=$(uname -s)"
    echo "host_arch=$(uname -m)"
    echo "ci=$CI"
    echo "soak_seconds=$SOAK_SECONDS"
    echo "allow_dirty=$ALLOW_DIRTY"
    echo "release_eligible=$RELEASE_ELIGIBLE"
    echo "last_step=$CURRENT_STEP"
    echo "log=$LOG_FILE"
  } > "$SUMMARY_FILE"
  echo
  echo "Release gate status: $STATUS"
  echo "Evidence: $EVIDENCE_DIR"
  exit "$rc"
}
trap finish EXIT

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Modbus Engineering Workbench 8.0.0 Local Mac Release Gate ==="
echo "UTC start : $START_UTC"
echo "Branch    : ${START_BRANCH:-detached}"
echo "HEAD      : $START_HEAD"
echo "macOS     : $(sw_vers -productVersion 2>/dev/null || echo unknown)"
echo "Arch      : $(uname -m)"
echo "CI        : $CI"
echo "Soak      : ${SOAK_SECONDS}s"
echo "Dirty mode: $ALLOW_DIRTY (release eligible: $RELEASE_ELIGIBLE)"

if [ "$ALLOW_DIRTY" != "1" ] && [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is not clean. Commit/stash changes or set RELEASE_GATE_ALLOW_DIRTY=1 for non-release diagnostics." >&2
  git status --short
  exit 3
fi

# Remove only ignored, deterministic test-runtime state. Never remove project
# data/, logs/ or any external/user-data directory as part of a release gate.
CURRENT_STEP="clean-test-runtime-artifacts"
rm -rf "$ROOT/.tmp" "$ROOT/test-results" "$ROOT/playwright-report"

# Load common Node version managers when available. The gate never silently
# skips a requested Node major; unavailable majors fail explicitly.
if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)"
fi

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

use_node() {
  target="$1"
  CURRENT_STEP="select-node-$target"

  if command -v node >/dev/null 2>&1 && [ "$(node_major)" = "$target" ]; then
    :
  elif type nvm >/dev/null 2>&1; then
    nvm install "$target"
    nvm use "$target"
  elif command -v fnm >/dev/null 2>&1; then
    fnm install "$target"
    fnm use "$target"
  else
    echo "ERROR: Node $target is required but is unavailable. Install nvm or fnm, or make Node $target current before running the gate." >&2
    return 4
  fi

  if [ "$(node_major)" != "$target" ]; then
    echo "ERROR: requested Node $target but active version is $(node --version 2>/dev/null || echo unavailable)." >&2
    return 4
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm is unavailable under Node $target." >&2
    return 4
  fi
  echo "Using Node $(node --version), npm $(npm --version)"
}

run_step() {
  CURRENT_STEP="$1"
  shift
  echo
  echo "--- $CURRENT_STEP ---"
  "$@"
}

for NODE_MAJOR in 20 22 24; do
  use_node "$NODE_MAJOR"
  run_step "node-${NODE_MAJOR}-npm-ci" npm ci
  run_step "node-${NODE_MAJOR}-version-check" npm run version:check
  run_step "node-${NODE_MAJOR}-v8-syntax" npm run check:v8
  run_step "node-${NODE_MAJOR}-tests" npm test
  run_step "node-${NODE_MAJOR}-smoke" npm run smoke
  run_step "node-${NODE_MAJOR}-acceptance" npm run acceptance
done

use_node 22
run_step "quality-npm-ci" npm ci
run_step "quality-version-check" npm run version:check
run_step "quality-lint" npm run lint
run_step "quality-v8-syntax" npm run check:v8
run_step "quality-v8-benchmark" npm run benchmark:v8
run_step "quality-v7-compat-benchmark" node scripts/benchmark-v7.js --cycles 25000 --min-fps 500 --max-heap-mb 384
run_step "quality-runtime-audit" npm run audit:runtime
run_step "quality-v8-soak" npm run soak:v8 -- --seconds "$SOAK_SECONDS"
run_step "browser-install-chromium" npx playwright install chromium
run_step "browser-e2e" npm run e2e

CURRENT_STEP="final-integrity"
if [ "$(git rev-parse HEAD)" != "$START_HEAD" ]; then
  echo "ERROR: repository HEAD changed while the release gate was running." >&2
  exit 5
fi
if [ "$ALLOW_DIRTY" != "1" ] && [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree changed while the release gate was running." >&2
  git status --short
  exit 5
fi
if [ "$ALLOW_DIRTY" = "1" ]; then
  CURRENT_STEP="dirty-diagnostic-not-release-eligible"
  echo "ERROR: RELEASE_GATE_ALLOW_DIRTY=1 is diagnostic-only and cannot produce release PASS evidence." >&2
  exit 6
fi

{
  echo "package-lock.json  $(shasum -a 256 package-lock.json | awk '{print $1}')"
  echo "desktop/package-lock.json  $(shasum -a 256 desktop/package-lock.json | awk '{print $1}')"
} > "$EVIDENCE_DIR/lockfile-sha256.txt"

STATUS="PASS"
CURRENT_STEP="complete"
echo
echo "LOCAL MAC RELEASE GATE: PASS"
