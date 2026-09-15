'use strict';

const path = require('node:path');
const { createV8ShellServer } = require('./v8/app/server');

function valueAfter(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) return fallback;
  return argv[index + 1];
}

function parseArgs(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const portText = valueAfter(argv, '--port', process.env.MODBUS_V8_PORT || '8188');
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1..65535');
  const host = valueAfter(argv, '--host', process.env.MODBUS_V8_HOST || '127.0.0.1');
  const dataDir = path.resolve(valueAfter(argv, '--data-dir', process.env.MODBUS_V8_DATA_DIR || path.join(process.cwd(), 'data')));
  return { help: false, host, port, dataDir };
}

function usage() {
  return [
    'Modbus Engineering Workbench v8 development shell',
    '',
    'Usage:',
    '  node src/index-v8-dev.js [--host 127.0.0.1] [--port 8188] [--data-dir ./data]',
    '',
    'Safety:',
    '  This development shell binds to loopback only.',
    '  Opening a saved connection requires explicit owner mode selection.',
    '  Persisted connection profiles always reopen unowned and write-locked.',
    '  The stable product runtime remains v7 until v8 release gates are complete.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }

  const shell = createV8ShellServer({ dataDir: options.dataDir });
  const address = await shell.start({ host: options.host, port: options.port });
  process.stdout.write(`Modbus Engineering Workbench v8 development shell: ${address.url}/v8/\n`);
  process.stdout.write(`Project data: ${options.dataDir}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await shell.stop(); } finally { process.exitCode = 0; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return shell;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
