#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { WorkbenchApiClient, WorkbenchClientError } = require('../src/v8/automation/workbenchClient');

function parse(argv) {
  const options = { baseUrl: process.env.MODBUS_V8_URL || 'http://127.0.0.1:8088', json: false, allowRemote: false, _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') options.baseUrl = argv[++i];
    else if (arg === '--json') options.json = true;
    else if (arg === '--allow-remote') options.allowRemote = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) options[key] = true;
      else { options[key] = next; i += 1; }
    } else options._.push(arg);
  }
  return options;
}

function number(value, field, fallback = undefined) {
  if (value == null && fallback !== undefined) return fallback;
  const out = Number(value);
  if (!Number.isFinite(out)) throw new WorkbenchClientError('INVALID_ARGUMENT', `${field} must be numeric`, { field, value });
  return out;
}

function boolFlag(value) { return value === true || String(value || '').toLowerCase() === 'true'; }
function values(value) {
  if (value == null || value === '') return null;
  return String(value).split(',').filter(Boolean).map((entry, index) => number(entry.trim(), `values[${index}]`));
}

function usage() {
  return [
    'Modbus Engineering Workbench v8 CLI',
    '',
    'Usage: npm run v8:cli -- <command> [options]',
    '',
    'Commands:',
    '  status',
    '  connections',
    '  open <connectionId> [--owner master]',
    '  close <connectionId>',
    '  test <connectionId>',
    '  read --connection ID --unit 1 --fc 3 --address 0 --quantity 1 [--timeout 1000]',
    '  write --connection ID --unit 1 --fc 6 --address 0 --value 10 --confirm [--read-back true]',
    '  write --connection ID --unit 1 --fc 16 --address 0 --values 1,2 --confirm --bulk-confirm',
    '  jobs | read-job <jobId>',
    '  scheduler-start <connectionId> | scheduler-stop <connectionId>',
    '  simulator-start <serverId> | simulator-stop <serverId>',
    '  recipe-run <recipe.json> [--connection ID]',
    '  twins | twin-apply <twinId> [--target-connection ID] | twin-approve <twinId> --confirm',
    '',
    'Global: --url http://127.0.0.1:8088 --json --allow-remote',
  ].join('\n');
}

async function run(argv = process.argv.slice(2)) {
  const options = parse(argv);
  const [command, subject] = options._;
  if (!command || command === 'help' || command === '--help') return { help: usage() };
  const client = new WorkbenchApiClient({ baseUrl: options.baseUrl, allowRemote: options.allowRemote });

  switch (command) {
    case 'status': return client.status();
    case 'connections': return client.listConnections();
    case 'open': return client.openConnection(subject, options.owner || 'master');
    case 'close': return client.closeConnection(subject);
    case 'test': return client.testConnection(subject);
    case 'read': return client.read({
      connectionId: options.connection,
      unitId: number(options.unit, 'unit', 1),
      functionCode: number(options.fc, 'fc', 3),
      address: number(options.address, 'address', 0),
      quantity: number(options.quantity, 'quantity', 1),
      ...(options.timeout == null ? {} : { timeoutMs: number(options.timeout, 'timeout') }),
    });
    case 'write': {
      const spec = {
        connectionId: options.connection,
        unitId: number(options.unit, 'unit', 1),
        functionCode: number(options.fc, 'fc'),
        address: number(options.address, 'address', 0),
        readBack: options.readBack == null ? true : boolFlag(options.readBack),
      };
      if (options.value != null) spec.value = number(options.value, 'value');
      if (options.values != null) spec.values = values(options.values);
      return client.write(spec, {
        confirmed: boolFlag(options.confirm),
        bulk: boolFlag(options.bulkConfirm),
        broadcast: boolFlag(options.broadcastConfirm),
      });
    }
    case 'jobs': return client.listJobs();
    case 'read-job': return client.readJob(subject);
    case 'scheduler-start': return client.startScheduler(subject);
    case 'scheduler-stop': return client.stopScheduler(subject);
    case 'simulator-start': return client.startSimulator(subject);
    case 'simulator-stop': return client.stopSimulator(subject);
    case 'recipe-run': {
      if (!subject) throw new WorkbenchClientError('INVALID_ARGUMENT', 'recipe-run requires a JSON recipe file');
      const recipe = JSON.parse(fs.readFileSync(subject, 'utf8'));
      return client.runRecipe(recipe, { defaultConnectionId: options.connection || null });
    }
    case 'twins': return client.listDigitalTwins();
    case 'twin-apply': return client.applyDigitalTwin(subject, { targetConnectionId: options.targetConnection || undefined });
    case 'twin-approve': return client.approveDigitalTwin(subject, { confirmed: boolFlag(options.confirm) });
    default: throw new WorkbenchClientError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
  }
}

function print(result, json = false) {
  if (result?.help) {
    process.stdout.write(`${result.help}\n`);
    return;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  const options = parse(process.argv.slice(2));
  run(process.argv.slice(2)).then(
    (result) => print(result, options.json),
    (error) => {
      const payload = { ok: false, error: { code: error.code || 'CLI_ERROR', message: error.message, details: error.details || null } };
      process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = { parse, run, usage };
