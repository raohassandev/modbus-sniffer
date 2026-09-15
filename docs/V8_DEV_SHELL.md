# v8 Development Shell

The v8 application shell is an **explicit development surface**, not the released/default product. Stable v7 remains the default `npm start` and desktop runtime until the v8 release gates are complete.

## Start

```powershell
npm install
npm run v8:dev
```

Open:

```text
http://127.0.0.1:8188/v8/
```

Optional development arguments:

```powershell
node src/index-v8-dev.js --host 127.0.0.1 --port 8188 --data-dir ./data
```

The development shell deliberately rejects non-loopback binds. Remote/LAN exposure is not enabled until the production v8 authentication/network-bind policy exists.

## Current workspaces

The shell currently enables:

- **Connection Center** — saved connection profiles plus exact Connection Broker runtime ownership/state.
- **Projects** — v8 schema-v3 project selection and migrated v7 evidence boundary.

The navigation also shows staged Master, Simulator, Traffic, Register Lab, Discovery, Test Center and Charts workspaces. Those stay visibly feature-gated until their runtime/UI acceptance packages are complete.

## Connection safety

A saved profile is configuration only. Saving or restoring a profile never opens a transport and never restores live ownership, write permission or fault injection.

To open a profile, the operator must explicitly choose an allowed runtime owner mode such as `ANALYZER`, `MASTER`, `SLAVE`, `DISCOVERY` or `TEST`. Allowed modes depend on the transport. The Connection Center displays the broker-reported state, owner, transmit capability and write lock rather than inferring them from UI selection.

Every newly opened/reopened active connection starts **WRITE LOCKED**. This development shell does not expose a write-unlock action. Active-mode write operations remain behind the tested runtime safety service and will only be exposed by a later Master/Test workspace package with confirmation/audit UI.

## Supported Connection Center transports

Current shell integration:

- Serial Modbus RTU
- Serial Modbus ASCII
- Modbus TCP client
- Modbus TCP server
- Virtual loopback / lab connection

Saved profile transport configuration is persisted in `workbench-v8.json`; live runtime state is not.

## v7 migration behavior

When the v8 store starts without a v8 project file and finds the existing v7 `workspaces.json`, it migrates schema-2 engineering data into separate schema-3 storage. The original v7 file is left unchanged and copied to a timestamped backup first.

Migrated channels become inactive/manual connection profiles. Their prior passive/activity status is metadata only and cannot become active ownership automatically. Existing channel-scoped device/register identities, discovery evidence, profiles, Legacy / Unassigned data and available project evidence are retained.

## Release boundary

Do not change root package version, default `npm start`, desktop launcher or product badges to v8 merely because this shell is usable. The v8 release candidate still requires the applicable P0/P1 roadmap gates, integrated workspaces, migration/browser/desktop acceptance, security checks and soak/interoperability validation.
