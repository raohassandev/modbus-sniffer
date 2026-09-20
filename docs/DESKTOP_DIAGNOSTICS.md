# Desktop Storage, Upgrade and Diagnostics

This document defines the supported local-data and diagnostic paths for the Modbus Engineering Tool desktop shell.

## Product mode

The desktop application launches the **unified Modbus Engineering Tool** runtime only.

- runtime: `src/index-v7.js`
- health endpoint: `/api/status`
- UI root: `/`
- the former v8 Workbench shell is not a desktop/product launch mode
- shared protocol, transport and safety primitives under `src/v8/**` may still be reused internally by the unified core

## Persistent user data

The desktop application stores writable engineering data under Electron's per-user `userData` directory, inside:

```text
<userData>/data
```

The packaged application does not use its installation/program directory as the normal writable project store.

On startup, `desktop/storage.js` prepares the user-data directory and can copy a legacy `workspaces.json`, backup and `history` tree into an empty desktop data directory. It deliberately does **not** merge legacy data into an already populated destination. A migration error stops startup and leaves the legacy source untouched so the operator can recover deliberately.

The migration report is written to:

```text
<userData>/data/.desktop-storage-v2.json
```

This supports upgrade/reinstall policy where application binaries may be replaced while per-user engineering data remains outside the installation directory. Uninstall/reinstall behavior must still be verified on the actual Windows installer/OS policy used for release; the installer must not be configured to delete the Electron user-data directory unless that behavior is explicitly approved.

## Desktop diagnostic log

The desktop shell writes persistent diagnostics to:

```text
<userData>/logs/workbench-desktop.log
```

The log records:

- desktop shell startup/platform/architecture and unified runtime
- selected user-data directory
- local backend startup/exit
- backend stdout/stderr
- backend process errors
- forced backend termination warnings
- renderer-process termination
- renderer unresponsive/responsive transitions
- startup/storage/health-check failures
- orderly desktop shutdown

The backend remains loopback-bound; the log must not be treated as an excuse to expose the local backend remotely.

## Support collection

When reporting a desktop startup or packaged-app failure, collect:

1. `workbench-desktop.log`
2. `.desktop-storage-v2.json`
3. exact installer/build version and SHA-256 checksum
4. Windows version/architecture
5. whether Windows Defender, firewall or endpoint security blocked the executable/network binding
6. the engineering handover/project bundle only when it is safe and authorized to share

Do not collect TLS private keys, credentials or unrelated customer files into a support bundle.

## Release boundary

Automated source-level tests can verify the storage/migration and diagnostic code paths. The following still require an actual target Windows machine:

- NSIS installer execution
- uninstall/reinstall behavior under the selected installer policy
- Windows Defender/firewall prompts
- driver/runtime compatibility
- final clean-machine packaged-app smoke
- production code signing when a real certificate/private key is supplied
## Local renderer port

The desktop shell prefers loopback port `18787` so browser-backed preferences, register mapping metadata and traffic bookmarks keep the same origin across normal launches. If that port is already occupied, the desktop app safely falls back to an ephemeral loopback port for that launch. `MODBUS_DESKTOP_PORT` can explicitly select another port from 1024–65535.

Durable Master Monitor Sessions do not depend on browser origin; they are stored under `<userData>/data/master-monitor-sessions.json` and are migrated with the rest of the desktop data store.
