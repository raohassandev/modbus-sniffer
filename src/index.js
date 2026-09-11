'use strict';

const readline = require('readline/promises');
const process = require('process');
const { stdin: input, stdout: output } = require('process');
const { parseArgs, helpText } = require('./cli');
const { PortManager } = require('./portManager');
const { FrameExtractor } = require('./modbus/frameExtractor');
const { decodeFrame } = require('./modbus/decoder');
const { TransactionTracker } = require('./modbus/transactionTracker');
const { MeterMap } = require('./meterMap');
const { CsvLogger } = require('./csvLogger');
const { renderTransaction, renderMeters, renderPorts } = require('./consoleRenderer');

async function choosePort(ports) {
  if (!ports.length) throw new Error('No serial ports found. Plug in the USB-RS485 adapter and retry.');
  if (ports.length === 1) {
    renderPorts(ports);
    console.log(`Auto-selected only available port: ${ports[0].path}`);
    return ports[0].path;
  }

  renderPorts(ports);
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('Select port number: ');
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > ports.length) throw new Error('Invalid port selection.');
    return ports[n - 1].path;
  } finally {
    rl.close();
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.log(helpText());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(helpText());
    return;
  }

  const ports = await PortManager.list();
  if (options.listPorts) {
    renderPorts(ports);
    return;
  }

  if (!options.port) options.port = await choosePort(ports);

  console.log('\n=== Modbus RTU Passive Sniffer ===');
  console.log(`Port      : ${options.port}`);
  console.log(`Serial    : ${options.baudRate}, ${options.dataBits}${options.parity[0].toUpperCase()}${options.stopBits}`);
  console.log(`Reconnect : ${options.reconnectMs} ms`);
  console.log(`COM rebind: ${options.autoRebind ? 'enabled' : 'disabled'}`);
  console.log('Mode      : RECEIVE/LISTEN ONLY (application never writes to the serial port)');
  console.log('Press Ctrl+C to stop.\n');

  const extractor = new FrameExtractor(options);
  const tracker = new TransactionTracker({ requestTimeoutMs: Math.max(2000, options.reconnectMs * 2) });
  const meterMap = MeterMap.fromFile(options.mapFile);
  const csv = new CsvLogger(options.csvFile);
  const pm = new PortManager(options);

  let validFrames = 0;
  let noiseBytes = 0;
  const bySlave = new Map();
  const byFunction = new Map();

  pm.on('identity', id => {
    if (!options.quiet) {
      const idText = [id.manufacturer, id.vendorId && `VID=${id.vendorId}`, id.productId && `PID=${id.productId}`, id.serialNumber && `SN=${id.serialNumber}`].filter(Boolean).join(' ');
      if (idText) console.log(`[PORT] Adapter identity: ${idText}`);
    }
  });
  pm.on('open', (_port, path) => console.log(`[PORT] OPEN ${path}`));
  pm.on('rebound', (from, to) => console.warn(`[PORT] Same USB adapter reappeared as ${to} (was ${from}); rebinding automatically.`));
  pm.on('scan-error', err => console.error(`[PORT] Port scan error: ${err.message}`));
  pm.on('open-error', (err, path) => {
    console.error(`[PORT] Cannot open ${path}: ${err.message}`);
    if (/access|busy|denied|permission/i.test(err.message)) {
      console.error('       The COM port may already be opened by another application. Windows COM ports are normally exclusive.');
    }
  });
  pm.on('port-error', err => console.error(`[PORT] Error: ${err.message}`));
  pm.on('close', (_err, path) => console.error(`[PORT] Closed/disconnected: ${path}`));
  pm.on('retry', (_reason, ms) => console.log(`[PORT] Retrying in ${ms} ms...`));
  pm.on('data', chunk => extractor.push(chunk, Date.now()));

  extractor.on('frame', (raw, timestamp) => {
    validFrames++;
    const decoded = decodeFrame(raw);
    bySlave.set(decoded.slaveId, (bySlave.get(decoded.slaveId) || 0) + 1);
    byFunction.set(decoded.functionCode, (byFunction.get(decoded.functionCode) || 0) + 1);
    const tx = tracker.process(decoded, timestamp);
    renderTransaction(tx, timestamp, raw, { raw: options.raw });
    const meters = meterMap.resolve(tx);
    if (meters.length) renderMeters(meters);
    csv.write(tx, timestamp, raw);
  });

  extractor.on('noise', buf => {
    noiseBytes += buf.length;
    if (!options.quiet && noiseBytes % 64 < buf.length) {
      console.warn(`[LINE] ${noiseBytes} undecodable/noise byte(s) seen so far. Check baud/parity/wiring if this keeps increasing.`);
    }
  });

  const statsTimer = setInterval(() => {
    if (options.quiet) return;
    const slaves = [...bySlave.entries()].sort((a, b) => a[0] - b[0]).map(([id, n]) => `${id}:${n}`).join(' ');
    const fcs = [...byFunction.entries()].sort((a, b) => a[0] - b[0]).map(([fc, n]) => `${fc}:${n}`).join(' ');
    console.log(`[STATS] frames=${validFrames} noise=${noiseBytes}${slaves ? ` | slaves ${slaves}` : ''}${fcs ? ` | FC ${fcs}` : ''}`);
  }, 10000);
  statsTimer.unref?.();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(statsTimer);
    extractor.flush();
    await pm.stop();
    console.log(`\nStopped. validFrames=${validFrames}, noiseBytes=${noiseBytes}`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await pm.start();
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
