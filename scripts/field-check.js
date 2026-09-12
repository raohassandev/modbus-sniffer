'use strict';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function narg(name, fallback) { const v = Number(arg(name, fallback)); return Number.isFinite(v) ? v : fallback; }

const base = String(arg('--url', 'http://127.0.0.1:8080')).replace(/\/$/, '');
const minDevices = Math.max(1, narg('--min-devices', 1));
const minFrames = Math.max(1, narg('--min-frames', 50));
const maxNoisePct = Math.max(0, narg('--max-noise-pct', 1));
const maxTimeoutPct = Math.max(0, narg('--max-timeout-pct', 5));
const maxUnmatchedPct = Math.max(0, narg('--max-unmatched-pct', 2));

async function get(path) {
  const r = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function row(name, ok, value, note = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark.padEnd(5)} ${name.padEnd(28)} ${String(value).padEnd(14)} ${note}`);
  return ok;
}

async function main() {
  const [status, analysis, devices, polls, registers] = await Promise.all([
    get('/api/status'), get('/api/analysis'), get('/api/devices'), get('/api/polls'), get('/api/registers?limit=20000')
  ]);

  const t = status.totals || {};
  const rates = analysis.rates || {};
  const requestCount = Number(t.requests || 0);
  const timeoutRate = requestCount ? Number(t.timeouts || 0) / requestCount * 100 : 0;
  const noisePct = Number(rates.noiseRatio || 0);
  const unmatchedPct = Number(rates.unmatchedResponseRate || 0);
  const open = ['open', 'demo', 'capture', 'replay'].includes(status.connection?.status);
  const onlineDevices = devices.filter(d => d.status === 'online').length;
  const offlineDevices = devices.filter(d => d.status === 'offline').length;

  console.log('\n=== Modbus Sniffer v4 Field Acceptance Check ===');
  console.log(`Source: ${base}\n`);

  const critical = [];
  critical.push(row('Analyzer reachable', true, 'OK'));
  critical.push(row('Capture source active', open, status.connection?.status || 'unknown'));
  critical.push(row('Valid Modbus frames', Number(t.frames || 0) >= minFrames, Number(t.frames || 0), `minimum ${minFrames}`));
  critical.push(row('Requests observed', requestCount > 0, requestCount));
  critical.push(row('Responses observed', Number(t.responses || 0) > 0, Number(t.responses || 0)));
  critical.push(row('Automatic devices', devices.length >= minDevices, devices.length, `minimum ${minDevices}`));
  critical.push(row('Polling groups learned', polls.length > 0, polls.length));
  critical.push(row('Registers discovered', registers.length > 0, registers.length));
  critical.push(row('Line noise', noisePct <= maxNoisePct, `${noisePct.toFixed(3)}%`, `limit ${maxNoisePct}%`));
  critical.push(row('Unmatched responses', unmatchedPct <= maxUnmatchedPct, `${unmatchedPct.toFixed(3)}%`, `limit ${maxUnmatchedPct}%`));
  critical.push(row('Timeout rate', timeoutRate <= maxTimeoutPct, `${timeoutRate.toFixed(3)}%`, `limit ${maxTimeoutPct}%`));

  console.log(`\nINFO  Online devices              ${onlineDevices}`);
  console.log(`INFO  Offline devices             ${offlineDevices}`);
  console.log(`INFO  Exceptions                  ${Number(t.exceptions || 0)}`);
  console.log(`INFO  Avg RTT                     ${t.avgRttMs == null ? '—' : `${t.avgRttMs} ms`}`);
  console.log(`INFO  P95 RTT                     ${t.p95RttMs == null ? '—' : `${t.p95RttMs} ms`}`);

  if (critical.every(Boolean)) {
    console.log('\nFIELD ACCEPTANCE CHECK: PASS\n');
    return;
  }
  console.log('\nFIELD ACCEPTANCE CHECK: FAIL — review failed lines above.\n');
  process.exitCode = 2;
}

main().catch(err => {
  console.error('\nFIELD ACCEPTANCE CHECK: ERROR');
  console.error(err.message);
  console.error(`Make sure the app is running at ${base}.`);
  process.exitCode = 1;
});
