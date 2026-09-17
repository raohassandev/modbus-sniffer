# Desktop Storage, Upgrade and Diagnostics

This document defines the supported local-data and diagnostic paths for the Modbus Sniffer desktop shell.

## Product mode

The desktop application now defaults to the accepted **stable Sniffer / Analyzer** runtime. The experimental v8 Workbench is not the normal product entry point while its Master/Slave workflow is being redesigned.

- default desktop mode: stable Sniffer (`src/index-v7.js`, `/api/status`, `/`)
- explicit experimental mode: set `MODBUS_DESKTOP_MODE=v8` before launching the desktop app
- normal users and release smoke tests must not be silently redirected into the experimental Workbench

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

- desktop shell startup/platform/architecture and selected mode
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
