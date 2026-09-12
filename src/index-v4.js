'use strict';

const readline = require('readline/promises');
const process = require('process');
const { stdin: input, stdout: output } = require('process');
const { parseArgs, helpText } = require('./cli');
const { PortManager } = require('./portManager');
const { FrameExtractor } = require('./modbus/frameExtractor');
const { decodeFrame } = require('./modbus/decoder');
const { AdvancedTransactionTracker } = require('./modbus/advancedTransactionTracker');
const { MeterMap } = require('./meterMap');
const { CsvLogger } = require('./csvLogger');
const { renderTransaction, renderMeters, renderPorts } = require('./consoleRenderer');
const { AdvancedRuntimeState } = require('./advancedRuntimeState');
const { startAdvancedWebServer } = require('./advancedWebServer');
const { ReplayController } = require('./replayController');
const { startDemo } = require('./demoGenerator');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function choosePort(ports) {
  if (!ports.length) throw new Error('No serial ports found. Plug in the USB-RS485 adapter and retry.');
  if (ports.length === 1) { renderPorts(ports); console.log(`Auto-selected only available port: ${ports[0].path}`); return ports[0].path; }
  renderPorts(ports);
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('Select port number: ');
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > ports.length) throw new Error('Invalid port selection.');
    return ports[n - 1].path;
  } finally { rl.close(); }
}

function publicConfig(options) {
  return {
    port: options.port,
    baudRate: options.baudRate,
    parity: options.parity,
    dataBits: options.dataBits,
    stopBits: options.stopBits,
    reconnectMs: options.reconnectMs,
    requestTimeoutMs: options.requestTimeoutMs,
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
  try { options = parseArgs(process.argv.slice(2)); }
  catch (err) { console.error(err.message); console.log(helpText()); process.exitCode = 2; return; }
  if (options.help) { console.log(helpText()); return; }
  if (!Number.isFinite(options.requestTimeoutMs)) options.requestTimeoutMs = 1000;

  const ports = options.demo ? [] : await PortManager.list();
  if (options.listPorts) { renderPorts(ports); return; }
  if (!options.demo && !options.port) {
    if (!options.webEnabled) options.port = await choosePort(ports);
    else if (ports.length === 1) { options.port = ports[0].path; console.log(`Auto-selected only available port: ${options.port}`); }
  }

  console.log('\n=== Modbus RTU Passive Sniffer v4 ===');
  console.log(`Mode      : ${options.demo ? 'DEMO / SIMULATED TRAFFIC' : 'RECEIVE/LISTEN ONLY'}`);
  if (!options.demo) {
    console.log(`Port      : ${options.port || 'not selected yet (use Web UI > Settings)'}`);
    console.log(`Serial    : ${options.baudRate}, ${options.dataBits}${options.parity[0].toUpperCase()}${options.stopBits}`);
    console.log(`Req timeout: ${options.requestTimeoutMs} ms`);
    console.log(`Reconnect : ${options.reconnectMs} ms`);
    console.log(`COM rebind: ${options.autoRebind ? 'enabled' : 'disabled'}`);
    console.log('TX        : disabled by design; application never writes Modbus bytes');
  }
  console.log('Press Ctrl+C to stop.\n');

  const state = new AdvancedRuntimeState({ historyLimit: options.historyLimit });
  state.setConfig(publicConfig(options));
  const replay = new ReplayController(state);
  const meterMap = MeterMap.fromFile(options.mapFile);
  const csv = new CsvLogger(options.csvFile);
  let tracker;
  let extractor = null;
  let probeExtractor = null;

  const makeTracker = () => {
    tracker = new AdvancedTransactionTracker({
      requestTimeoutMs: options.requestTimeoutMs,
      onTimeout: (request, expiredAt, timeoutMs) => state.recordTimeout(request, expiredAt, timeoutMs)
    });
  };
  makeTracker();

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
      if (!options.quiet && state.noiseBytes % 128 < buf.length) console.warn(`[LINE] ${state.noiseBytes} undecodable/noise byte(s). Check serial format/wiring if this keeps increasing.`);
    });
    extractor = next;
  };
  bindExtractor();

  const pm = new PortManager(options);
  pm.on('identity', id => {
    if (!options.quiet) {
      const text = [id.manufacturer, id.vendorId && `VID=${id.vendorId}`, id.productId && `PID=${id.productId}`, id.serialNumber && `SN=${id.serialNumber}`].filter(Boolean).join(' ');
      if (text) console.log(`[PORT] Adapter identity: ${text}`);
    }
  });
  pm.on('open', (_port, portPath) => {
    console.log(`[PORT] OPEN ${portPath}`);
    options.port = portPath;
    state.setConfig(publicConfig(options));
    state.setConnection(probeExtractor ? 'detecting' : 'open', { path: portPath, message: probeExtractor ? 'Testing serial format' : null });
  });
  pm.on('rebound', (from, to) => {
    console.warn(`[PORT] Same USB adapter reappeared as ${to} (was ${from}); rebinding automatically.`);
    state.setConnection('reconnecting', { path: to, message: `Rebound from ${from}` });
  });
  pm.on('scan-error', err => { console.error(`[PORT] Port scan error: ${err.message}`); state.setConnection('error', { message: err.message }); });
  pm.on('open-error', (err, portPath) => {
    console.error(`[PORT] Cannot open ${portPath}: ${err.message}`);
    if (/access|busy|denied|permission/i.test(err.message)) console.error('       COM port may already be owned by another application.');
    state.setConnection('error', { path: portPath, message: err.message });
  });
  pm.on('port-error', err => { console.error(`[PORT] Error: ${err.message}`); state.setConnection('error', { message: err.message }); });
  pm.on('close', (_err, portPath) => { if (!pm.stopping) console.error(`[PORT] Closed/disconnected: ${portPath}`); if (!pm.stopping) state.setConnection('closed', { path: portPath, message: 'Port closed/disconnected' }); });
  pm.on('retry', (_reason, ms) => { console.log(`[PORT] Retrying in ${ms} ms...`); state.setConnection('reconnecting', { message: `Retrying in ${ms} ms` }); });
  pm.on('data', chunk => {
    const target = probeExtractor || extractor;
    target?.push(chunk, Date.now());
  });

  const disconnectSerial = async () => {
    probeExtractor = null;
    await pm.stop();
    tracker.clear();
    state.setConnection('idle', { path: options.port || null, message: 'Serial capture disconnected' });
  };

  const configureSerial = async next => {
    replay.stop();
    probeExtractor = null;
    extractor?.flush();
    Object.assign(options, next);
    makeTracker();
    bindExtractor();
    state.setCaptureSource('live');
    state.setConfig(publicConfig(options));
    state.setConnection('connecting', { path: options.port, message: 'Applying serial configuration' });
    await pm.reconfigure(next);
  };

  const autoDetectSerial = async request => {
    const port = String(request.port || options.port || '').trim();
    if (!port) throw new Error('Select a COM port before auto-detection.');
    const full = Boolean(request.full);
    const sampleMs = Math.max(300, Math.min(3000, Number(request.sampleMs) || (full ? 850 : 700)));
    const baudRates = Array.isArray(request.baudRates) && request.baudRates.length ? request.baudRates.map(Number) : (full ? [2400, 4800, 9600, 19200, 38400, 57600, 115200] : [9600, 19200, 38400, 115200]);
    const parities = Array.isArray(request.parities) && request.parities.length ? request.parities.map(String) : (full ? ['none', 'even', 'odd'] : ['none', 'even']);
    const original = { port: options.port, baudRate: options.baudRate, parity: options.parity, dataBits: options.dataBits, stopBits: options.stopBits, reconnectMs: options.reconnectMs, requestTimeoutMs: options.requestTimeoutMs };
    replay.stop();
    tracker.clear();
    state.setConnection('detecting', { path: port, message: 'Scanning baud/parity combinations' });
    const results = [];

    try {
      for (const baudRate of baudRates) {
        for (const parity of parities) {
          let frames = 0; let noiseBytes = 0; let bytes = 0;
          const candidate = { port, baudRate, parity, dataBits: 8, stopBits: 1, reconnectMs: options.reconnectMs };
          const probe = new FrameExtractor(candidate);
          probe.on('frame', raw => { frames++; bytes += raw.length; });
          probe.on('noise', buf => { noiseBytes += buf.length; bytes += buf.length; });
          probeExtractor = probe;
          Object.assign(options, candidate);
          state.setConnection('detecting', { path: port, message: `Testing ${baudRate} 8${parity[0].toUpperCase()}1` });
          let error = null;
          try {
            await pm.reconfigure(candidate);
            await sleep(sampleMs);
            probe.flush();
          } catch (err) { error = err.message; }
          const cleanRatio = bytes ? Math.max(0, 1 - noiseBytes / bytes) : 0;
          const score = frames > 0 ? Math.round(frames * 10000 + cleanRatio * 1000 - noiseBytes) : -noiseBytes;
          results.push({ baudRate, parity, dataBits: 8, stopBits: 1, frames, noiseBytes, bytes, cleanRatio: roundLocal(cleanRatio * 100, 2), score, error });
        }
      }
    } finally { probeExtractor = null; }

    results.sort((a, b) => b.score - a.score || b.frames - a.frames || a.noiseBytes - b.noiseBytes);
    const best = results.find(r => r.frames > 0) || null;
    const finalCfg = best ? { port, baudRate: best.baudRate, parity: best.parity, dataBits: 8, stopBits: 1, reconnectMs: original.reconnectMs, requestTimeoutMs: original.requestTimeoutMs } : { ...original, port: original.port || port };
    Object.assign(options, finalCfg);
    makeTracker();
    bindExtractor();
    state.clearCapture();
    state.setCaptureSource('live');
    state.setConfig(publicConfig(options));
    state.setConnection('connecting', { path: finalCfg.port, message: best ? 'Applying detected serial format' : 'Restoring previous serial format' });
    await pm.reconfigure(finalCfg);
    return { detected: Boolean(best), best, sampleMs, tested: results.length, candidates: results, config: publicConfig(options) };
  };

  let web = null;
  if (options.webEnabled) {
    web = await startAdvancedWebServer({ state, options, configureSerial, disconnectSerial, autoDetectSerial, replay, demo: options.demo });
    console.log(`[WEB] UI ready: ${web.url}`);
    console.log('[WEB] Dashboard / Devices / Traffic / Analysis / Registers / Decoder / Sessions / Settings\n');
  }

  let stopDemo = null;
  if (options.demo) {
    state.setConnection('demo', { path: 'SIMULATOR', message: 'Synthetic Modbus RTU traffic' });
    stopDemo = startDemo({ onFrame: processFrame, onNoise: count => state.recordNoise(count) });
  } else if (options.port) {
    state.setConnection('connecting', { path: options.port, message: 'Opening serial port' });
    await pm.start();
  } else {
    state.setConnection('idle', { path: null, message: 'Select a serial port in Settings' });
    console.log('[PORT] No port selected. Open the Web UI and choose one under Settings.');
  }

  const timeoutTimer = setInterval(() => tracker.expire(Date.now()), Math.max(50, Math.min(250, Math.floor(options.requestTimeoutMs / 4))));
  timeoutTimer.unref?.();
  const statsTimer = setInterval(() => {
    if (options.quiet) return;
    const s = state.getStatus();
    console.log(`[STATS] frames=${s.totals.frames} fps=${s.totals.framesPerSecond} devices=${s.totals.devices} polls=${s.totals.pollGroups} regs=${s.totals.registers} timeouts=${s.totals.timeouts} exceptions=${s.totals.exceptions} avgRTT=${s.totals.avgRttMs ?? '-'}ms`);
  }, 10000);
  statsTimer.unref?.();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timeoutTimer); clearInterval(statsTimer);
    replay.stop(); stopDemo?.(); extractor?.flush();
    if (!options.demo) await pm.stop();
    if (web) await web.close();
    const s = state.getStatus();
    console.log(`\nStopped. validFrames=${s.totals.frames}, devices=${s.totals.devices}, timeouts=${s.totals.timeouts}, noiseBytes=${s.totals.noiseBytes}`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

function roundLocal(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
}

main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
