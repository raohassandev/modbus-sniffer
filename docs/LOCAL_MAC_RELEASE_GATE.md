# Local Mac Release Gate — Modbus Engineering Tool 8.0.0

This repository uses a deterministic **local MacBook release gate** as the primary software-release validation path.

GitHub-hosted CI is not an automatic release dependency. `.github/workflows/test.yml` is retained only as a manually dispatched option for a self-hosted runner that is explicitly registered for this repository.

## Preconditions

Run the gate from a clean checkout of the exact release branch/head on macOS.

Required tools:

- Git
- Node.js 20, 22 and 24 through `nvm` or `fnm` (the script may install the requested major through the configured version manager)
- npm for each Node major
- internet access for `npm ci` and Playwright Chromium installation
- normal macOS developer/runtime prerequisites used by native npm modules

Do not run a release gate from a dirty worktree. The script rejects tracked or untracked changes by default so the evidence maps to one exact Git commit.

The gate also removes inherited `npm_config_prefix` / `NPM_CONFIG_PREFIX` environment overrides before loading NVM. This prevents Homebrew or shell npm-prefix settings from aborting Node-version selection and keeps the release toolchain under the gate's control.

## Run the release gate

```bash
git checkout v8-release-completion
git pull --ff-only
npm run release:gate:mac
```

The gate records the starting Git SHA and then validates:

1. Node.js 20
   - `npm ci`
   - version consistency
   - project-wide JavaScript syntax checks
   - compatibility-v8 syntax checks
   - full unit/integration test suite
   - smoke suite
   - acceptance suite
2. Node.js 22
   - the same complete suite
3. Node.js 24
   - the same complete suite
4. Release-quality checks on Node.js 22
   - lint
   - project-wide JavaScript syntax
   - compatibility-v8 syntax
   - bounded v8 scale benchmark
   - v7 compatibility benchmark
   - runtime dependency audit
   - concurrent v8 virtual soak
   - Playwright Chromium installation
   - unified-runtime browser E2E
   - compatibility-shell browser regression E2E
5. Final integrity
   - repository HEAD must still equal the starting SHA
   - tracked and untracked source/worktree state must remain clean for a release-eligible run
   - diagnostic dirty mode is explicitly prevented from producing release PASS evidence
   - both npm lockfile SHA-256 values are retained in the evidence directory

Any failed or unavailable required Node major fails the gate. The script does not silently skip a release matrix entry.

## Evidence

Every run creates an ignored directory:

```text
.release-evidence/<UTC timestamp>-<commit prefix>/
```

It contains:

```text
release-gate.log
summary.txt
lockfile-sha256.txt
```

A release-validation result is usable only when all of these are true:

- `summary.txt` contains `status=PASS`;
- `summary.txt` contains `allow_dirty=0`;
- `summary.txt` contains `release_eligible=1`;
- `start_head` and `end_head` are identical;
- that SHA is still the exact PR #31 head when merge is considered;
- no later source commit has superseded the evidence.

If the PR head changes after a PASS, run the complete gate again. Do not reuse evidence from an older head.

## Soak duration

The normal release gate uses a bounded concurrent v8 soak of 60 seconds. A different duration can be supplied without editing source:

```bash
RELEASE_GATE_SOAK_SECONDS=600 npm run release:gate:mac
```

The required **24-hour extended soak** is separate acceptance evidence and is not implied by the short release gate. Run it explicitly when required:

```bash
npm run soak:v8 -- --seconds 86400
```

Retain its terminal/log evidence together with the exact commit SHA and environment details.

## Diagnostic-only dirty execution

For non-release troubleshooting only, the clean-tree guard can be bypassed:

```bash
RELEASE_GATE_ALLOW_DIRTY=1 npm run release:gate:mac
```

The diagnostic suite may execute, but the gate intentionally exits non-zero before the PASS assignment. Its summary records `allow_dirty=1` and `release_eligible=0`, so dirty execution cannot be mistaken for valid merge evidence.

## Optional self-hosted GitHub execution

The existing `automatrix-macbook-01` runner documented in `raohassandev/automatrix-engineering` was registered to that repository URL and therefore cannot execute jobs for `raohassandev/modbus-sniffer` merely because the labels match.

If GitHub self-hosted execution is desired later, a runner instance must be registered specifically for `raohassandev/modbus-sniffer` (or at an organization scope that includes it). Until then, use the local Mac gate above.

## External acceptance boundary

The local Mac gate does not manufacture evidence for:

- real RS485 electrical/noise/termination behavior;
- third-party PLC, inverter, meter or gateway interoperability;
- representative external TLS endpoints/certificates;
- clean Windows installer/Defender/firewall/serial-driver behavior;
- production code signing;
- required 24-hour site/virtual soak evidence.

Those remain tracked in `SITE_ACCEPTANCE.md` and the release closure ledger.
