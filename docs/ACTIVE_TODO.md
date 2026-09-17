# Modbus Engineering Workbench v8 — Active TODO

**Status date:** 2026-09-17  
**Release:** 8.0.0 release candidate  
**Branch:** `v8-release-completion`  
**PR:** #31

This file is the short active checklist for release closure.

`V8_MASTER_TODO.md` is the historical planning inventory and intentionally retains its original unchecked boxes. Do not interpret those boxes as current implementation gaps without reconciling them against:

- `V8_IMPLEMENTATION_STATUS.md`
- `V8_RELEASE_CLOSURE.md`
- this active checklist

## Software/source closure

- [x] v8 default runtime and v7 explicit compatibility path
- [x] WP-01 through WP-18 implementation audited on the release branch
- [x] root package version = 8.0.0
- [x] root lockfile top/root package version = 8.0.0
- [x] desktop package version = 8.0.0
- [x] desktop lockfile top/root package version = 8.0.0
- [x] temporary metadata bootstrap/self-modifying CI removed
- [x] deterministic local Mac release gate added: `npm run release:gate:mac`
- [x] local gate evidence directory ignored by Git
- [x] GitHub validation changed to manual-only
- [x] Windows hosted packaging changed to manual-only
- [x] release-gate/manual-only workflow invariants regression-covered
- [x] release docs reconciled with local Mac gate
- [x] diagnostic dirty mode cannot produce release PASS evidence
- [x] inherited npm prefix overrides are sanitized before NVM initialization

## Exact-head release evidence

- [ ] Run `npm run release:gate:mac` on a clean Mac checkout of the **final exact PR head**.
- [ ] Confirm `.release-evidence/.../summary.txt` reports `status=PASS`.
- [ ] Confirm `allow_dirty=0` and `release_eligible=1`.
- [ ] Confirm `start_head == end_head == current PR #31 head`.
- [ ] Retain the release-gate log and lockfile SHA-256 evidence.
- [ ] Re-run the full gate if any source commit is added after the PASS.
- [ ] Merge PR #31 only after the exact-head evidence above is valid.
- [ ] Verify `main` after merge before declaring the software release complete.

## Extended acceptance — evidence required, not missing source implementation

- [ ] 24-hour v8 virtual/TCP soak with retained evidence
- [ ] multi-hour Historian/logger disk-growth and reopen evidence
- [ ] representative PLC interoperability
- [ ] representative inverter interoperability
- [ ] representative power-meter interoperability
- [ ] representative TCP/RTU gateway with multiple Unit IDs
- [ ] representative external TLS interoperability
- [ ] real RS485 electrical/noise/termination/timing qualification
- [ ] clean Windows NSIS install/launch/uninstall/reinstall verification
- [ ] Windows Defender/firewall/serial-driver verification
- [ ] production code signing when production signing material is supplied

See `SITE_ACCEPTANCE.md` for field procedures.

## Merge rule

`mergeable=true` is not a release pass. The source release candidate is merge-ready only after the final exact PR head has a valid local Mac release-gate PASS evidence set.
