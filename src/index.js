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
const { RuntimeState } = require('./runtimeState');
const { startWebServer } = require('./webServer');
const { startDemo } = require('./demoGenerator');

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

function publicConfig(options) {
  return {
    port: options.port,
    baudRate: options.baudRate,
    parity: options.parity,
    dataBits: options.dataBits,
    stopBits: options.stopBits,
    reconnectMs: options.reconnectMs,
    autoRebind: options.autoRebind,
    mapFile: options.mapFile,
    csvFile: options.csvFile,
    historyLimit: options.historyLimit,
    webHost: options.webHost,
    webPort: options.webPort
  };
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

  const ports = options.demo ? [] : await PortManager.list();
  if (options.listPorts) {
    renderPorts(ports);
    return;
  }

  if (!options.demo && !options.port) {
    if (!options.webEnabled) options.port = await choosePort(ports);
    else if (ports.length === 1) {
      options.port = ports[0].path;
      console.log(`Auto-selected only available port: ${options.port}`);
    }
  }

  console.log('\n=== Modbus RTU Passive Sniffer v2 ===');
  console.log(`Mode      : ${options.demo ? 'DEMO / SIMULATED TRAFFIC' : 'RECEIVE/LISTEN ONLY'}`);
  if (!options.demo) {
    console.log(`Port      : ${options.port || 'not selected yet (use Web UI > Settings)'}`);
    console.log(`Serial    : ${options.baudRate}, ${options.dataBits}${options.parity[0].toUpperCase()}${options.stopBits}`);
    console.log(`Reconnect : ${options.reconnectMs} ms`);
    console.log(`COM rebind: ${options.autoRebind ? 'enabled' : 'disabled'}`);
    console.log('TX        : disabled by design; application never writes Modbus bytes');
  }
  console.log('Press Ctrl+C to stop.\n');

  const state = new RuntimeState({ historyLimit: options.historyLimit });
  state.setConfig(publicConfig(options));
  const meterMap = MeterMap.fromFile(options.mapFile);
  const csv = new CsvLogger(options.csvFile);
  let tracker = new TransactionTracker({ requestTimeoutMs: Math.max(2000, options.reconnectMs * 2) });
  let extractor = null;

  const processFrame = (raw, timestamp = Date.now()) => {
    const decoded = decodeFrame(raw);
    const tx = tracker.process(decoded, timestamp);
    renderTransaction(tx, timestamp, raw, { raw: options.raw });
    const meters = meterMap.resolve(tx);
    if (meters.length) renderMeters(meters);
    csv.write(tx, timestamp, raw);
    state.recordFrame(tx, timestamp, raw, meters);
  };

  const bindExtractor = () => {
    const next = new FrameExtractor(options);
    next.on('frame', (raw, timestamp) => processFrame(raw, timestamp));
    next.on('noise', buf => {
      state.recordNoise(buf.length);
      if (!options.quiet && state.noiseBytes % 64 < buf.length) {
        console.warn(`[LINE] ${state.noiseBytes} undecodable/noise byte(s) seen so far. Check baud/parity/wiring if this keeps increasing.`);
      }
    });
    extractor = next;
  };

  bindExtractor();
  const pm = new PortManager(options);

  pm.on('identity', id => {
    if (!options.quiet) {
      const idText = [id.manufacturer, id.vendorId && `VID=${id.vendorId}`, id.productId && `PID=${id.productId}`, id.serialNumber && `SN=${id.serialNumber}`].filter(Boolean).join(' ');
      if (idText) console.log(`[PORT] Adapter identity: ${idText}`);
    }
  });
  pm.on('open', (_port, path) => {
    console.log(`[PORT] OPEN ${path}`);
    options.port = path;
    state.setConfig(publicConfig(options));
    state.setConnection('open', { path, message: null });
  });
  pm.on('rebound', (from, to) => {
    console.warn(`[PORT] Same USB adapter reappeared as ${to} (was ${from}); rebinding automatically.`);
    state.setConnection('reconnecting', { path: to, message: `Rebound from ${from}` });
  });
  pm.on('scan-error', err => {
    console.error(`[PORT] Port scan error: ${err.message}`);
    state.setConnection('error', { message: err.message });
  });
  pm.on('open-error', (err, path) => {
    console.error(`[PORT] Cannot open ${path}: ${err.message}`);
    if (/access|busy|denied|permission/i.test(err.message)) console.error('       COM port may already be owned by another application.');
    state.setConnection('error', { path, message: err.message });
  });
  pm.on('port-error', err => {
    console.error(`[PORT] Error: ${err.message}`);
    state.setConnection('error', { message: err.message });
  });
  pm.on('close', (_err, path) => {
    console.error(`[PORT] Closed/disconnected: ${path}`);
    state.setConnection('closed', { path, message: 'Port closed/disconnected' });
  });
  pm.on('retry', (_reason, ms) => {
    console.log(`[PORT] Retrying in ${ms} ms...`);
    state.setConnection('reconnecting', { message: `Retrying in ${ms} ms` });
  });
  pm.on('data', chunk => extractor.push(chunk, Date.now()));

  const configureSerial = async next => {
    extractor.flush();
    Object.assign(options, next);
    tracker = new TransactionTracker({ requestTimeoutMs: Math.max(2000, options.reconnectMs * 2) });
    bindExtractor();
    state.setConfig(publicConfig(options));
    state.setConnection('connecting', { path: options.port, message: 'Applying serial configuration' });
    await pm.reconfigure(next);
  };

  let web = null;
  if (options.webEnabled) {
    web = await startWebServer({ state, options, configureSerial, demo: options.demo });
    console.log(`[WEB] UI ready: ${web.url}`);
    console.log('[WEB] Dashboard / Traffic / Analysis / Registers / Settings\n');
  }

  let stopDemo = null;
  if (options.demo) {
    state.setConnection('demo', { path: 'SIMULATOR', message: 'Synthetic Modbus RTU traffic' });
    stopDemo = startDemo({
      onFrame: processFrame,
      onNoise: count => state.recordNoise(count)
    });
  } else if (options.port) {
    state.setConnection('connecting', { path: options.port, message: 'Opening serial port' });
    await pm.start();
  } else {
    state.setConnection('idle', { path: null, message: 'Select a serial port in Settings' });
    console.log('[PORT] No port selected. Open the Web UI and choose one under Settings.');
  }

  const statsTimer = setInterval(() => {
    if (options.quiet) return;
    const s = state.getStatus();
    console.log(`[STATS] frames=${s.totals.frames} fps=${s.totals.framesPerSecond} noise=${s.totals.noiseBytes} exceptions=${s.totals.exceptions} slaves=${s.totals.slaves} avgRTT=${s.totals.avgRttMs ?? '-'}ms`);
  }, 10000);
  statsTimer.unref?.();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(statsTimer);
    stopDemo?.();
    extractor.flush();
    if (!options.demo) await pm.stop();
    if (web) await web.close();
    const s = state.getStatus();
    console.log(`\nStopped. validFrames=${s.totals.frames}, noiseBytes=${s.totals.noiseBytes}`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
