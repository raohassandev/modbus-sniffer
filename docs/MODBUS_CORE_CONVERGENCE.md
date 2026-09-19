# Shared Modbus Core Convergence

**Status:** active architecture lane  
**Goal:** converge the temporary v7/v8 recovery state into one reusable Modbus core without regressing the accepted Sniffer.

## Current duplication

### Accepted product path
- `src/index-v7.js`
- stable Sniffer/analyzer runtime
- `src/master/masterRuntime.js`
- `src/master/masterRoutes.js`
- `public/master-v7.js`
- `public/master-format-v7.js`
- `public/master-sessions-v7.js`

### Experimental v8 path
- `src/index-v8.js`
- `src/v8/master/masterWorkspaceService*.js`
- `src/v8/master/masterWorkspaceRoutes.js`
- `public/v8/master.js`
- `public/v8/standard-monitor.js`
- Connection Center/project workspace shell

### Shared implementation already reused
- `src/v8/protocol/**`
- `src/v8/transports/**`
- `src/v8/connectionBroker.js`
- `src/v8/master/masterEngine.js`
- `src/v8/master/writeSafety.js`

The stable Master was already using those v8 primitives directly, which proves they are reusable core logic rather than v8-only UI code.

## Canonical boundary introduced

`src/modbusCore.js` is now the explicit shared facade for protocol/runtime/transport primitives.

Current consumers:
- stable `src/master/masterRuntime.js`

Rule for new work:
- do not introduce another protocol implementation
- do not introduce another serial/TCP ownership model
- protocol/transport capability belongs behind `modbusCore` or modules it delegates to
- UI pages call product services; they do not own protocol semantics
- Traffic/evidence is shared across modes

## Migration sequence

1. Stable Master consumes canonical core — **started**
2. Move shared datatype/register interpretation behind reusable core service
3. Move Discovery active requests through the same request/evidence contract
4. Move Test Center validated requests through the same ownership/evidence model
5. Move Slave server runtime through canonical transport/protocol exports
6. Consolidate v8 Master scheduler/write safety into reusable Master services
7. Migrate valuable v8-only Modbus workspaces into unified shell
8. Remove duplicate Master/workbench paths after regression + UX acceptance

## Non-negotiable behavior

- stable passive Sniffer remains receive-only unless user explicitly enters active mode
- one serial resource cannot have conflicting owners
- write/LAB armed state is never restored from disk
- every active request can generate shared Traffic evidence
- simulator responses use the same protocol encoders/decoders tested by Master/Test Center
- no feature-specific copy of CRC/LRC/MBAP or function-code semantics
