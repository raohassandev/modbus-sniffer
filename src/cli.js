'use strict';

function parseArgs(argv) {
  const out = {
    port: null,
    baudRate: 9600,
    parity: 'none',
    dataBits: 8,
    stopBits: 1,
    reconnectMs: 2000,
    requestTimeoutMs: 1000,
    mapFile: null,
    csvFile: null,
    raw: true,
    listPorts: false,
    quiet: false,
    autoRebind: true,
    webEnabled: true,
    webHost: '127.0.0.1',
    webPort: 8080,
    historyLimit: 5000,
    demo: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value after ${a}`);
      return argv[++i];
    };

    switch (a) {
      case '--port': out.port = next(); break;
      case '--baud': out.baudRate = Number(next()); break;
      case '--parity': out.parity = next().toLowerCase(); break;
      case '--data-bits': out.dataBits = Number(next()); break;
      case '--stop-bits': out.stopBits = Number(next()); break;
      case '--reconnect': out.reconnectMs = Number(next()); break;
      case '--request-timeout': out.requestTimeoutMs = Number(next()); break;
      case '--map': out.mapFile = next(); break;
      case '--csv': out.csvFile = next(); break;
      case '--no-raw': out.raw = false; break;
      case '--quiet': out.quiet = true; break;
      case '--list-ports': out.listPorts = true; break;
      case '--no-rebind': out.autoRebind = false; break;
      case '--no-web': out.webEnabled = false; break;
      case '--web-host': out.webHost = next(); break;
      case '--web-port': out.webPort = Number(next()); break;
      case '--history': out.historyLimit = Number(next()); break;
      case '--demo': out.demo = true; break;
      case '--help': out.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (![5, 6, 7, 8].includes(out.dataBits)) throw new Error('data-bits must be 5, 6, 7, or 8');
  if (![1, 2].includes(out.stopBits)) throw new Error('stop-bits must be 1 or 2');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(out.parity)) throw new Error('parity must be none/even/odd/mark/space');
  if (!Number.isFinite(out.baudRate) || out.baudRate <= 0) throw new Error('baud must be positive');
  if (!Number.isFinite(out.reconnectMs) || out.reconnectMs < 250) throw new Error('reconnect must be at least 250 ms');
  if (!Number.isFinite(out.requestTimeoutMs) || out.requestTimeoutMs < 50 || out.requestTimeoutMs > 60000) throw new Error('request-timeout must be 50..60000 ms');
  if (!Number.isInteger(out.webPort) || out.webPort < 1 || out.webPort > 65535) throw new Error('web-port must be 1..65535');
  if (!Number.isInteger(out.historyLimit) || out.historyLimit < 100 || out.historyLimit > 100000) throw new Error('history must be 100..100000');
  return out;
}

function helpText() {
  return `
Modbus RTU Passive Sniffer v4

Usage:
  node src/index-v4.js [options]

Serial options:
  --list-ports              List serial ports and exit
  --port COM5               Serial port. It can also be selected in Settings
  --baud 9600               Baud rate (default 9600)
  --parity none             none/even/odd/mark/space (default none)
  --data-bits 8             Data bits (default 8)
  --stop-bits 1             Stop bits (default 1)
  --request-timeout 1000    Missing-response timeout in ms (50..60000)
  --reconnect 2000          Retry interval after disconnect/busy error
  --no-rebind               Do not follow an adapter if Windows changes its COM number

Capture options:
  --map config/map.json     Optional register/meter map
  --csv capture.csv         Optional transaction CSV log
  --history 5000            In-memory event history (100..100000)
  --no-raw                  Hide raw HEX from console
  --quiet                   Reduce console informational messages

Web UI options:
  --web-host 127.0.0.1      Web bind address (default local machine only)
  --web-port 8080           Web UI port
  --no-web                  Disable browser interface
  --demo                    Run simulated Modbus traffic; no hardware required

Examples:
  npm start -- --port COM5 --baud 9600 --parity none --request-timeout 800
  npm start -- --port COM7 --baud 19200 --parity even --map config/register-map.example.json
  npm run demo
`;
}

module.exports = { parseArgs, helpText };
