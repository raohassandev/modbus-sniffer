# Modbus Engineering Analyzer v6

v6 completes the planned product layer on top of the v4.1 RTU analyzer.

## Included

- Automatic Modbus RTU slave-device formation and polling analysis from v4.1.
- Persistent Projects with site/bus metadata.
- Editable device identity: name, manufacturer, model and notes.
- Persistent register engineering maps: name, type, byte order, scale, offset and unit.
- Reusable device profiles that can be created from one slave and applied to another.
- Live engineering-value decoding from mapped 16/32/64-bit registers.
- Persistent project history snapshots stored under the local `data` directory.
- Deep diagnostics for unmatched replies, possible duplicate slave behavior, high polling jitter, timeouts, writes and estimated RTU bus utilization.
- HTML diagnostic report suitable for browser Print / Save PDF.
- Modbus TCP MBAP parser and transaction tracker.
- Optional inline Modbus TCP analyzer proxy. The proxy forwards client/server bytes unchanged and analyzes them. It is not a passive Ethernet tap.
- Windows Electron packaging project and a manual GitHub Actions installer build.

## Run

```powershell
npm install
npm start
```

Open `http://127.0.0.1:8080`.

## TCP proxy

CLI example:

```powershell
npm start -- --tcp-proxy --tcp-listen-port 1502 --tcp-target-host 192.168.1.50 --tcp-target-port 502
```

Point the Modbus TCP client at the analyzer host and port 1502. The analyzer forwards the connection to the configured target and records MBAP request/response timing.

## Windows desktop installer

From the repository root:

```powershell
npm install
npm run desktop:install
npm run desktop:win
```

The installer output is created under `desktop/dist/`.

A manual GitHub workflow named **Build Windows desktop installer** is also provided.

## Persistent data

The default local data directory is `data/` and is intentionally git-ignored. It contains the workspace database and per-project JSONL history. Use `--data-dir <path>` to place it elsewhere.

## Safety boundary

RTU remains receive-only and never writes Modbus bytes. The TCP analyzer is explicitly an inline forwarding proxy: it forwards bytes already sent by the TCP client and does not fabricate Modbus requests. Do not confuse TCP proxy mode with a passive network tap.
