'use strict';

const { EventEmitter } = require('node:events');
const { createWorkbenchEvent } = require('../events');

class DynamicValueError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DynamicValueError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, DynamicValueError);
  }
}

const KINDS = Object.freeze(new Set(['constant', 'counter', 'sawtooth', 'sine', 'random', 'timestamp', 'copy', 'formula', 'schedule']));
const AREAS = Object.freeze(new Set(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters']));

function finite(value, field, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    if (fallback != null) return fallback;
    throw new DynamicValueError('INVALID_GENERATOR', `${field} must be a finite number`, { field, value });
  }
  return number;
}

function integer(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    if (fallback != null) return fallback;
    throw new DynamicValueError('INVALID_GENERATOR', `${field} must be an integer between ${min} and ${max}`, { field, value });
  }
  return number;
}

function clampRegister(value) {
  return Math.max(0, Math.min(0xFFFF, Math.round(Number(value) || 0)));
}

function normalizeTarget(input) {
  const area = String(input.area || 'holdingRegisters');
  if (!AREAS.has(area)) throw new DynamicValueError('INVALID_GENERATOR', `Unsupported generator area ${area}`, { area });
  const address = integer(input.address, 'address', { min: 0, max: 65535 });
  const quantity = integer(input.quantity ?? 1, 'quantity', { min: 1, max: 125 });
  return { area, address, quantity };
}

function tokenize(expression) {
  const text = String(expression || '').trim();
  if (!text) throw new DynamicValueError('INVALID_FORMULA', 'Formula expression is required');
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if ('+-*/%()'.includes(char)) { tokens.push(char); index += 1; continue; }
    const number = text.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { tokens.push(Number(number[0])); index += number[0].length; continue; }
    const ident = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (ident) {
      if (!['x', 't', 'i'].includes(ident[0])) throw new DynamicValueError('INVALID_FORMULA', `Unsupported formula symbol ${ident[0]}`);
      tokens.push(ident[0]); index += ident[0].length; continue;
    }
    throw new DynamicValueError('INVALID_FORMULA', `Unsupported formula token near ${text.slice(index, index + 12)}`);
  }
  return tokens;
}

function compileFormula(expression) {
  const tokens = tokenize(expression);
  const output = [];
  const operators = [];
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, 'u-': 3 };
  let expectValue = true;
  for (const token of tokens) {
    if (typeof token === 'number' || ['x', 't', 'i'].includes(token)) {
      output.push(token); expectValue = false; continue;
    }
    if (token === '(') { operators.push(token); expectValue = true; continue; }
    if (token === ')') {
      while (operators.length && operators.at(-1) !== '(') output.push(operators.pop());
      if (operators.pop() !== '(') throw new DynamicValueError('INVALID_FORMULA', 'Unbalanced formula parentheses');
      expectValue = false; continue;
    }
    let operator = token;
    if (operator === '-' && expectValue) operator = 'u-';
    if (expectValue && operator !== 'u-') throw new DynamicValueError('INVALID_FORMULA', 'Formula operator is missing a left operand');
    while (operators.length && operators.at(-1) !== '(' && precedence[operators.at(-1)] >= precedence[operator]) output.push(operators.pop());
    operators.push(operator); expectValue = true;
  }
  if (expectValue) throw new DynamicValueError('INVALID_FORMULA', 'Formula is missing a final operand');
  while (operators.length) {
    const operator = operators.pop();
    if (operator === '(') throw new DynamicValueError('INVALID_FORMULA', 'Unbalanced formula parentheses');
    output.push(operator);
  }
  return Object.freeze({ expression: String(expression), rpn: Object.freeze(output) });
}

function evaluateFormula(compiled, variables) {
  const stack = [];
  for (const token of compiled.rpn) {
    if (typeof token === 'number') stack.push(token);
    else if (['x', 't', 'i'].includes(token)) stack.push(Number(variables[token] || 0));
    else if (token === 'u-') stack.push(-Number(stack.pop() || 0));
    else {
      const b = Number(stack.pop());
      const a = Number(stack.pop());
      let result;
      if (token === '+') result = a + b;
      else if (token === '-') result = a - b;
      else if (token === '*') result = a * b;
      else if (token === '/') result = b === 0 ? 0 : a / b;
      else result = b === 0 ? 0 : a % b;
      stack.push(Number.isFinite(result) ? result : 0);
    }
  }
  if (stack.length !== 1) throw new DynamicValueError('INVALID_FORMULA', 'Formula evaluation did not reduce to one value');
  return stack[0];
}

function normalizeConfig(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DynamicValueError('INVALID_GENERATOR', 'Generator must be an object');
  const generatorId = String(input.generatorId || existing?.generatorId || '').trim();
  if (!generatorId) throw new DynamicValueError('INVALID_GENERATOR', 'generatorId is required');
  const serverId = String(input.serverId || existing?.serverId || '').trim();
  if (!serverId) throw new DynamicValueError('INVALID_GENERATOR', 'serverId is required');
  const unitId = integer(input.unitId ?? existing?.unitId, 'unitId', { min: 1, max: 255 });
  const kind = String(input.kind || existing?.kind || '').trim().toLowerCase();
  if (!KINDS.has(kind)) throw new DynamicValueError('INVALID_GENERATOR', `Unsupported generator kind ${kind}`, { kind });
  const target = normalizeTarget({ ...(existing || {}), ...input });
  const intervalMs = integer(input.intervalMs ?? existing?.intervalMs ?? 250, 'intervalMs', { min: 20, max: 86_400_000 });
  const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params)
    ? JSON.parse(JSON.stringify(input.params))
    : JSON.parse(JSON.stringify(existing?.params || {}));
  const config = {
    generatorId,
    serverId,
    unitId,
    kind,
    ...target,
    intervalMs,
    enabled: input.enabled ?? existing?.enabled ?? true,
    params,
  };
  if (kind === 'formula') config.compiled = compileFormula(params.expression);
  if (kind === 'copy') {
    config.copySource = normalizeTarget({
      area: params.sourceArea || target.area,
      address: params.sourceAddress,
      quantity: params.sourceQuantity ?? target.quantity,
    });
    if (config.copySource.quantity !== target.quantity) throw new DynamicValueError('INVALID_GENERATOR', 'Copy source quantity must match target quantity');
  }
  if (kind === 'schedule') {
    if (!Array.isArray(params.steps) || !params.steps.length) throw new DynamicValueError('INVALID_GENERATOR', 'Schedule requires a non-empty params.steps array');
    config.schedule = params.steps.map((step, index) => ({
      afterMs: integer(step.afterMs, `steps[${index}].afterMs`, { min: 0, max: 86_400_000 }),
      value: step.value,
    })).sort((a, b) => a.afterMs - b.afterMs);
  }
  return config;
}

class DynamicValueEngine extends EventEmitter {
  constructor({ resolveDevice, tickMs = 20, clock = () => Date.now(), random = Math.random } = {}) {
    super();
    if (typeof resolveDevice !== 'function') throw new TypeError('resolveDevice is required');
    this.resolveDevice = resolveDevice;
    this.tickMs = integer(tickMs, 'tickMs', { min: 5, max: 1000 });
    this.clock = clock;
    this.random = random;
    this.configs = new Map();
    this.runtime = new Map();
    this.timer = null;
    this.running = false;
    this.stats = { ticks: 0, updates: 0, failures: 0, lastError: null };
  }

  upsert(input) {
    const current = this.configs.get(String(input?.generatorId || '')) || null;
    const config = normalizeConfig(input, current);
    this.configs.set(config.generatorId, config);
    this.runtime.set(config.generatorId, {
      startedAt: this.clock(),
      nextDueAt: this.clock(),
      counter: Number(config.params.start ?? 0),
      saw: Number(config.params.start ?? config.params.min ?? 0),
      iterations: 0,
      lastValue: null,
      lastError: null,
      lastUpdatedAt: null,
    });
    this._emit('simulator.generator-saved', config, { kind: config.kind });
    return this.get(config.generatorId);
  }

  remove(generatorId) {
    const id = String(generatorId);
    const config = this.configs.get(id);
    if (!config) return false;
    this.configs.delete(id);
    this.runtime.delete(id);
    this._emit('simulator.generator-removed', config);
    return true;
  }

  get(generatorId) {
    const config = this.configs.get(String(generatorId));
    if (!config) throw new DynamicValueError('GENERATOR_NOT_FOUND', `Generator ${generatorId} was not found`, { generatorId });
    const runtime = this.runtime.get(config.generatorId) || {};
    const { compiled, copySource, schedule, ...persisted } = config;
    return Object.freeze({
      ...JSON.parse(JSON.stringify(persisted)),
      runtime: Object.freeze({ ...runtime }),
    });
  }

  list({ serverId = null, unitId = null } = {}) {
    return Object.freeze([...this.configs.values()]
      .filter((config) => serverId == null || config.serverId === serverId)
      .filter((config) => unitId == null || config.unitId === Number(unitId))
      .map((config) => this.get(config.generatorId)));
  }

  start() {
    if (this.running) return this.snapshot();
    this.running = true;
    this._schedule();
    return this.snapshot();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({ running: this.running, generatorCount: this.configs.size, ...this.stats });
  }

  _schedule() {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._tick();
      this._schedule();
    }, this.tickMs);
    this.timer.unref?.();
  }

  _tick() {
    const now = this.clock();
    this.stats.ticks += 1;
    for (const config of this.configs.values()) {
      if (!config.enabled) continue;
      const runtime = this.runtime.get(config.generatorId);
      if (!runtime || runtime.nextDueAt > now) continue;
      runtime.nextDueAt = now + config.intervalMs;
      try {
        const device = this.resolveDevice(config.serverId, config.unitId);
        if (!device) throw new DynamicValueError('DEVICE_NOT_RUNNING', `Virtual device ${config.unitId} on ${config.serverId} is not running`);
        const values = this._values(config, runtime, device, now);
        device.seed(config.area, config.address, values);
        runtime.lastValue = values.length === 1 ? values[0] : [...values];
        runtime.lastUpdatedAt = now;
        runtime.lastError = null;
        runtime.iterations += 1;
        this.stats.updates += 1;
        this._emit('simulator.generator-update', config, { values, iteration: runtime.iterations });
      } catch (error) {
        runtime.lastError = { code: error?.code || null, message: String(error?.message || error), at: now };
        this.stats.failures += 1;
        this.stats.lastError = runtime.lastError;
        this._emit('simulator.generator-error', config, { errorCode: error?.code || null, error: String(error?.message || error) });
      }
    }
  }

  _values(config, runtime, device, now) {
    const bit = config.area === 'coils' || config.area === 'discreteInputs';
    if (config.kind === 'copy') return device.read(config.copySource.area, config.copySource.address, config.copySource.quantity);
    let scalar;
    if (config.kind === 'constant') scalar = config.params.value ?? 0;
    else if (config.kind === 'counter') {
      scalar = runtime.counter;
      const step = finite(config.params.step ?? 1, 'params.step');
      const min = finite(config.params.min ?? 0, 'params.min');
      const max = finite(config.params.max ?? 65535, 'params.max');
      let next = scalar + step;
      if (step >= 0 && next > max) next = config.params.wrap === false ? max : min;
      if (step < 0 && next < min) next = config.params.wrap === false ? min : max;
      runtime.counter = next;
    } else if (config.kind === 'sawtooth') {
      scalar = runtime.saw;
      const step = finite(config.params.step ?? 1, 'params.step');
      const min = finite(config.params.min ?? 0, 'params.min');
      const max = finite(config.params.max ?? 100, 'params.max');
      const next = scalar + step;
      runtime.saw = step >= 0 ? (next > max ? min : next) : (next < min ? max : next);
    } else if (config.kind === 'sine') {
      const offset = finite(config.params.offset ?? 0, 'params.offset');
      const amplitude = finite(config.params.amplitude ?? 1, 'params.amplitude');
      const periodMs = finite(config.params.periodMs ?? 1000, 'params.periodMs');
      scalar = offset + amplitude * Math.sin(((now - runtime.startedAt) / Math.max(1, periodMs)) * Math.PI * 2);
    } else if (config.kind === 'random') {
      const min = finite(config.params.min ?? 0, 'params.min');
      const max = finite(config.params.max ?? 65535, 'params.max');
      scalar = min + this.random() * Math.max(0, max - min);
    } else if (config.kind === 'timestamp') {
      const unit = String(config.params.unit || 'seconds');
      scalar = unit === 'milliseconds' ? now : Math.floor(now / 1000);
    } else if (config.kind === 'formula') {
      const current = device.read(config.area, config.address, 1)[0];
      scalar = evaluateFormula(config.compiled, { x: Number(current), t: (now - runtime.startedAt) / 1000, i: runtime.iterations });
    } else if (config.kind === 'schedule') {
      const duration = Math.max(1, integer(config.params.cycleMs ?? config.schedule.at(-1).afterMs + config.intervalMs, 'params.cycleMs', { min: 1, max: 86_400_000 }));
      const elapsed = (now - runtime.startedAt) % duration;
      scalar = config.schedule[0].value;
      for (const step of config.schedule) if (elapsed >= step.afterMs) scalar = step.value;
    } else scalar = 0;

    if (bit) return Array.from({ length: config.quantity }, () => Boolean(Number(scalar)));
    if (config.kind === 'timestamp' && config.quantity > 1) {
      let value = BigInt(Math.max(0, Math.floor(Number(scalar))));
      const words = new Array(config.quantity).fill(0);
      for (let index = config.quantity - 1; index >= 0; index -= 1) {
        words[index] = Number(value & 0xFFFFn);
        value >>= 16n;
      }
      return words;
    }
    return Array.from({ length: config.quantity }, () => clampRegister(scalar));
  }

  _emit(type, config, details = {}) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'simulator-generator',
      ownerMode: 'slave',
      unitId: config.unitId,
      details: { generatorId: config.generatorId, serverId: config.serverId, area: config.area, address: config.address, ...details },
    }));
  }
}

module.exports = {
  AREAS,
  KINDS,
  DynamicValueEngine,
  DynamicValueError,
  compileFormula,
  evaluateFormula,
  normalizeConfig,
};
