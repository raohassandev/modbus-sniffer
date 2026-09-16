'use strict';

const path = require('node:path');
const { startV8WorkbenchServer } = require('./v8/workbenchServer');

function parseArgs(argv) {
  const options = {
    webHost: '127.0.0.1',
    webPort: 18778,
    dataDir: path.join(process.cwd(), 'data'),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      i += 1;
      return argv[i];
    };
    if (arg === '--web-host') options.webHost = value();
    else if (arg === '--web-port') options.webPort = Number(value());
    else if (arg === '--data-dir') options.dataDir = path.resolve(value());
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.webPort) || options.webPort < 0 || options.webPort > 65535) throw new Error('--web-port must be 0..65535');
  return options;
}

function help() {
  return [
    'Modbus Engineering Workbench v8 preview',
    '',
    'Usage: node src/index-v8-preview.js [options]',
    '',
    '  --web-host HOST   bind host (default 127.0.0.1)',
    '  --web-port PORT   bind port (default 18778)',
    '  --data-dir DIR    project data directory (default ./data)',
    '  --quiet           suppress startup URL',
    '  --help            show this help',
    '',
    'This preview does not replace the stable v7 entry point.',
  ].join('\n');
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); console.error(help()); process.exitCode = 2; return; }
  if (options.help) { console.log(help()); return; }

  const preview = await startV8WorkbenchServer({
    dataDir: options.dataDir,
    host: options.webHost,
    port: options.webPort,
    quiet: options.quiet,
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await preview.close();
  };
  process.on('SIGINT', async () => { await stop(); process.exit(0); });
  process.on('SIGTERM', async () => { await stop(); process.exit(0); });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, help, main };
