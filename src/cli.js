'use strict';

function parseArgs(argv) {
  const out = {
    port: null,
    baudRate: 9600,
    parity: 'none',
    dataBits: 8,
    stopBits: 1,
    reconnectMs: 2000,
    mapFile: null,
    csvFile: null,
    raw: true,
    listPorts: false,
    quiet: false,
    autoRebind: true
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
      case '--map': out.mapFile = next(); break;
      case '--csv': out.csvFile = next(); break;
      case '--no-raw': out.raw = false; break;
      case '--quiet': out.quiet = true; break;
      case '--list-ports': out.listPorts = true; break;
      case '--no-rebind': out.autoRebind = false; break;
      case '--help': out.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (![5, 6, 7, 8].includes(out.dataBits)) throw new Error('data-bits must be 5, 6, 7, or 8');
  if (![1, 2].includes(out.stopBits)) throw new Error('stop-bits must be 1 or 2');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(out.parity)) throw new Error('parity must be none/even/odd/mark/space');
  if (!Number.isFinite(out.baudRate) || out.baudRate <= 0) throw new Error('baud must be positive');
  if (!Number.isFinite(out.reconnectMs) || out.reconnectMs < 250) throw new Error('reconnect must be at least 250 ms');
  return out;
}

function helpText() {
  return `
Passive Modbus RTU Sniffer (console)

Usage:
  node src/index.js [options]

Options:
  --list-ports              List serial ports and exit
  --port COM5               Port to open; if omitted, interactive selection is used
  --baud 9600               Baud rate (default 9600)
  --parity none             none/even/odd/mark/space (default none)
  --data-bits 8             Data bits (default 8)
  --stop-bits 1             Stop bits (default 1)
  --reconnect 2000          Retry interval after disconnect/busy error (default 2000 ms)
  --no-rebind               Do not follow the same USB adapter if Windows changes its COM number
  --map config/map.json     Optional register/meter map
  --csv capture.csv         Optional transaction CSV log
  --no-raw                  Hide raw HEX from console
  --quiet                   Reduce informational messages
  --help                    Show this help

Examples:
  npm start -- --port COM5 --baud 9600 --parity none
  npm start -- --port COM7 --baud 19200 --parity even --map config/register-map.example.json
`;
}

module.exports = { parseArgs, helpText };
