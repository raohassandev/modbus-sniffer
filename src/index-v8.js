'use strict';

const path = require('node:path');
const process = require('node:process');
const { ConnectionBroker } = require('./v8/connectionBroker');
const { V8ProjectStore } = require('./v8/project');
const { startV8ProductServer } = require('./v8/workbenchServerV8');
const { loadFeatureFlags } = require('./v8/featureFlags');
const { PRODUCT_NAME, PRODUCT_VERSION } = require('./v8/version');

function parseArgs(argv) {
  const options = {
    host: process.env.MODBUS_V8_HOST || '127.0.0.1',
    port: Number(process.env.MODBUS_V8_PORT || 8088),
    dataDir: process.env.MODBUS_V8_DATA_DIR || path.resolve(process.cwd(), 'data'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host') options.host = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--data-dir') options.dataDir = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('--port must be 0..65535');
  if (!options.host) throw new Error('--host is required');
  return options;
}

function helpText() {
  return [
    `${PRODUCT_NAME} v${PRODUCT_VERSION}`,
    '',
    'Usage: node src/index-v8.js [options]',
    '',
    '  --host <ip>       Web bind address (default 127.0.0.1)',
    '  --port <number>   Web port (default 8088, use 0 for ephemeral)',
    '  --data-dir <dir>  Project data directory (default ./data)',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const store = new V8ProjectStore({ dataDir: options.dataDir });
  const broker = new ConnectionBroker();
  const flags = loadFeatureFlags();
  const web = await startV8ProductServer({ store, broker, host: options.host, port: options.port, flags });

  console.log(`=== ${PRODUCT_NAME} v${PRODUCT_VERSION} ===`);
  console.log(`Web      : ${web.url}`);
  console.log(`Projects : ${path.resolve(options.dataDir)}`);
  console.log(`Schema   : ${store.exportAll().schemaVersion}`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await web.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, helpText, main };
