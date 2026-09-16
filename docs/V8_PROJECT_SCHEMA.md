# v8 Workspace / Project Schema Contract

The v8 persistence boundary is versioned independently from the released application version.

- Workspace format: `modbus-engineering-workbench`
- Project format: `modbus-engineering-project`
- Schema version: `1`
- Product major represented by this schema: `8`

The stable product can remain v7 while this schema is developed and tested behind the v8 feature boundary.

## Safety contract

Persisted project data is configuration, engineering context and evidence. It is never authority to resume dangerous live capability.

On every v8 project/workspace load and save:

- `writeArmed` is forced to `false`.
- `faultInjectionArmed` is forced to `false`.
- active connection/runtime owner state is cleared.
- saved connection profiles omit owner, live state, write-lock and fault-injection fields.

A user must reconnect and explicitly re-arm writes in the live runtime after restart.

## Main project sections

A project contains:

- identity and site/bus metadata;
- safe UI preferences;
- feature flags;
- saved connection profiles;
- topology channels/devices;
- engineering register mappings and reusable engineering profiles;
- discovery/capture evidence references;
- Master documents and poll jobs;
- Simulator server definitions;
- Test Center recipes;
- chart/logger definitions;
- migration and legacy-preservation metadata.

The current schema intentionally allows later v8 workspaces to populate sections that are empty today without changing the top-level persistence model.

## v7 migration

Direct migration currently accepts the existing v7 `WorkspaceStore` schema version `2`.

Migration rules:

1. A timestamped copy of the original v7 file is created before replacement.
2. Every v7 project is migrated; the active project is preserved when valid.
3. v7 channels, devices, register mappings, discovery runs, legacy-unassigned data and reusable engineering profiles are carried forward.
4. Unknown v7 project/workspace fields are retained under migration/legacy evidence instead of being silently discarded.
5. Live write/fault capability is never migrated.
6. A machine-readable migration report is written beside the workspace.
7. Unsupported source versions are rejected explicitly rather than guessed.

## Atomic persistence and corruption handling

`V8ProjectStore` writes through a temporary file, flushes it, keeps a previous-file backup, then replaces the live workspace. A malformed JSON workspace is copied to a timestamped `.corrupt-*` file before the load fails, so the original evidence is not silently destroyed.

If the primary v8 workspace is missing but a known-good v8 backup exists, the store can recover the backup into the primary path and records that recovery in `lastMigrationReport`.

## Feature flags

Incomplete product surfaces remain disabled by default. The project-model foundation is enabled; Connection Center, Master UI, Simulator UI, Traffic/Register Lab, Test Center, historian, automation, HMI Builder and Secure Modbus/TLS remain behind explicit flags until their vertical integration and acceptance gates are complete.

Feature flags do not bypass Connection Broker ownership, write locks, raw/LAB confirmation, or persistence safety rules.
