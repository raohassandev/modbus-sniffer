'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');

const SAFE_POLL_FUNCTIONS = new Set([
  protocol.FC.READ_COILS,
  protocol.FC.READ_DISCRETE_INPUTS,
  protocol.FC.READ_HOLDING_REGISTERS,
  protocol.FC.READ_INPUT_REGISTERS,
  protocol.FC.ENCAPSULATED_INTERFACE,
]);

class PollSchedulerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PollSchedulerError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, PollSchedulerError);
  }
}

function positiveNumber(value, field, { allowZero = false } = {}) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new PollSchedulerError('INVALID_JOB', `${field} must be ${allowZero ? '>= 0' : '> 0'}`, { field, value });
  return value;
}

function normalizeJob(input, now = Date.now()) {
  if (!input || typeof input !== 'object') throw new PollSchedulerError('INVALID_JOB', 'job must be an object');
  if (typeof input.jobId !== 'string' || !input.jobId.trim()) throw new PollSchedulerError('INVALID_JOB', 'jobId is required');
  if (!Number.isInteger(input.unitId) || input.unitId < 0 || input.unitId > 255) throw new PollSchedulerError('INVALID_JOB', 'unitId must be 0..255');
  const pdu = Buffer.from(input.pdu ?? []);
  if (!pdu.length) throw new PollSchedulerError('INVALID_JOB', 'pdu is required');
  protocol.validatePdu(pdu);
  if (!SAFE_POLL_FUNCTIONS.has(pdu[0])) {
    throw new PollSchedulerError('UNSAFE_POLL_FUNCTION', 'Cyclic poll jobs are read-only and only support FC01/02/03/04/43. Use the guarded write/Test workflow for active writes or custom frames.', {
      functionCode: pdu[0],
    });
  }
  const intervalMs = positiveNumber(input.intervalMs ?? 1000, 'intervalMs');
  const timeoutMs = positiveNumber(input.timeoutMs ?? 1000, 'timeoutMs');
  const retries = input.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 20) throw new PollSchedulerError('INVALID_JOB', 'retries must be 0..20');
  const retryDelayMs = positiveNumber(input.retryDelayMs ?? Math.min(250, intervalMs), 'retryDelayMs', { allowZero: true });
  return {
    jobId: input.jobId.trim(),
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : input.jobId.trim(),
    unitId: input.unitId,
    pdu,
    intervalMs,
    timeoutMs,
    retries,
    retryDelayMs,
    enabled: input.enabled !== false,
    disableOnError: Boolean(input.disableOnError),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { ...input.metadata } : {},
    state: input.enabled === false ? 'disabled' : 'idle',
    nextDueAt: now,
    inFlight: false,
    cycleAttempt: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastResult: null,
    lastError: null,
    stats: {
      attempts: 0,
      cycles: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      exceptions: 0,
      retries: 0,
      totalRttMs: 0,
      lastRttMs: null,
      minRttMs: null,
      maxRttMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
    },
  };
}

function freezeJob(job) {
  const averageRttMs = job.stats.successes ? job.stats.totalRttMs / job.stats.successes : null;
  return Object.freeze({
    jobId: job.jobId,
    label: job.label,
    unitId: job.unitId,
    pduHex: job.pdu.toString('hex').toUpperCase(),
    intervalMs: job.intervalMs,
    timeoutMs: job.timeoutMs,
    retries: job.retries,
    retryDelayMs: job.retryDelayMs,
    enabled: job.enabled,
    disableOnError: job.disableOnError,
    metadata: Object.freeze({ ...job.metadata }),
    state: job.state,
    nextDueAt: job.nextDueAt,
    inFlight: job.inFlight,
    cycleAttempt: job.cycleAttempt,
    lastStartedAt: job.lastStartedAt,
    lastCompletedAt: job.lastCompletedAt,
    lastResult: job.lastResult,
    lastError: job.lastError ? Object.freeze({ ...job.lastError }) : null,
    stats: Object.freeze({ ...job.stats, averageRttMs }),
  });
}

class PollScheduler extends EventEmitter {
  constructor({ master, minimumInterRequestDelayMs = 0, tickMs = 10, maxDispatchPerTick = 32, clock = () => Date.now() } = {}) {
    super();
    if (!master || typeof master.request !== 'function') throw new TypeError('master with request() is required');
    this.master = master;
    this.minimumInterRequestDelayMs = positiveNumber(minimumInterRequestDelayMs, 'minimumInterRequestDelayMs', { allowZero: true });
    this.tickMs = positiveNumber(tickMs, 'tickMs');
    if (!Number.isInteger(maxDispatchPerTick) || maxDispatchPerTick < 1) throw new TypeError('maxDispatchPerTick must be a positive integer');
    this.maxDispatchPerTick = maxDispatchPerTick;
    this.clock = clock;
    this.jobs = new Map();
    this.running = false;
    this.paused = false;
    this.timer = null;
    this.lastDispatchAt = 0;
    this.sequence = 0;
  }

  addJob(options) {
    const job = normalizeJob(options, this.clock());
    this._validateTransportJob(job);
    if (this.jobs.has(job.jobId)) throw new PollSchedulerError('JOB_EXISTS', `Poll job ${job.jobId} already exists`, { jobId: job.jobId });
    job.sequence = this.sequence++;
    this.jobs.set(job.jobId, job);
    this._emit('poll.job-added', job);
    this._wake();
    return freezeJob(job);
  }

  updateJob(jobId, patch = {}) {
    const current = this._get(jobId);
    if (current.inFlight) throw new PollSchedulerError('JOB_BUSY', 'Cannot modify an in-flight job', { jobId });
    const merged = normalizeJob({
      ...current,
      ...patch,
      jobId: current.jobId,
      pdu: patch.pdu ?? current.pdu,
      metadata: patch.metadata ?? current.metadata,
    }, this.clock());
    this._validateTransportJob(merged);
    merged.stats = current.stats;
    merged.sequence = current.sequence;
    merged.lastStartedAt = current.lastStartedAt;
    merged.lastCompletedAt = current.lastCompletedAt;
    merged.lastResult = current.lastResult;
    merged.lastError = current.lastError;
    this.jobs.set(jobId, merged);
    this._emit('poll.job-updated', merged);
    this._wake();
    return freezeJob(merged);
  }

  removeJob(jobId) {
    const job = this._get(jobId);
    if (job.inFlight) throw new PollSchedulerError('JOB_BUSY', 'Cannot remove an in-flight job', { jobId });
    this.jobs.delete(jobId);
    this._emit('poll.job-removed', job);
  }

  enableJob(jobId, enabled = true) {
    const job = this._get(jobId);
    job.enabled = Boolean(enabled);
    job.state = job.enabled ? 'idle' : 'disabled';
    job.nextDueAt = this.clock();
    job.cycleAttempt = 0;
    this._emit(job.enabled ? 'poll.job-enabled' : 'poll.job-disabled', job);
    this._wake();
    return freezeJob(job);
  }

  start() {
    if (this.running) return this.snapshot();
    this.running = true;
    this.paused = false;
    this._emitScheduler('poll.scheduler-started');
    this._wake();
    return this.snapshot();
  }

  pause() {
    this.paused = true;
    this._clearTimer();
    this._emitScheduler('poll.scheduler-paused');
    return this.snapshot();
  }

  resume() {
    if (!this.running) return this.start();
    this.paused = false;
    this._emitScheduler('poll.scheduler-resumed');
    this._wake();
    return this.snapshot();
  }

  stop() {
    this.running = false;
    this.paused = false;
    this._clearTimer();
    this._emitScheduler('poll.scheduler-stopped');
    return this.snapshot();
  }

  async readNow(jobId) {
    const job = this._get(jobId);
    if (job.inFlight) throw new PollSchedulerError('JOB_BUSY', 'Poll job is already in flight', { jobId });
    return this._dispatch(job, { forced: true });
  }

  getJob(jobId) { return freezeJob(this._get(jobId)); }
  listJobs() { return Object.freeze([...this.jobs.values()].sort((a, b) => a.sequence - b.sequence).map(freezeJob)); }

  snapshot() {
    return Object.freeze({
      running: this.running,
      paused: this.paused,
      minimumInterRequestDelayMs: this.minimumInterRequestDelayMs,
      tickMs: this.tickMs,
      jobCount: this.jobs.size,
      enabledJobs: [...this.jobs.values()].filter((job) => job.enabled).length,
      inFlightJobs: [...this.jobs.values()].filter((job) => job.inFlight).length,
      lastDispatchAt: this.lastDispatchAt || null,
    });
  }

  _wake() {
    if (!this.running || this.paused || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._tick().catch((error) => this.emit('scheduler-error', error));
    }, this.tickMs);
    this.timer.unref?.();
  }

  async _tick() {
    if (!this.running || this.paused) return;
    const now = this.clock();
    const due = [...this.jobs.values()]
      .filter((job) => job.enabled && !job.inFlight && job.nextDueAt <= now)
      .sort((a, b) => a.nextDueAt - b.nextDueAt || a.sequence - b.sequence)
      .slice(0, this.maxDispatchPerTick);

    for (const job of due) {
      const wait = this.minimumInterRequestDelayMs - (this.clock() - this.lastDispatchAt);
      if (wait > 0) break;
      this._dispatch(job).catch(() => undefined);
      this.lastDispatchAt = this.clock();
      if (this.minimumInterRequestDelayMs > 0) break;
    }
    this._wake();
  }

  async _dispatch(job, { forced = false } = {}) {
    if (job.inFlight) throw new PollSchedulerError('JOB_BUSY', 'Poll job is already in flight', { jobId: job.jobId });
    job.inFlight = true;
    job.state = 'running';
    job.lastStartedAt = this.clock();
    job.stats.attempts += 1;
    if (job.cycleAttempt === 0) job.stats.cycles += 1;
    this._emit('poll.job-started', job, { forced, attempt: job.cycleAttempt + 1 });
    try {
      const result = await this.master.request({ unitId: job.unitId, pdu: job.pdu, timeoutMs: job.timeoutMs });
      const now = this.clock();
      const rtt = Number.isFinite(result?.rttMs) ? result.rttMs : Math.max(0, now - job.lastStartedAt);
      job.stats.successes += 1;
      job.stats.totalRttMs += rtt;
      job.stats.lastRttMs = rtt;
      job.stats.minRttMs = job.stats.minRttMs == null ? rtt : Math.min(job.stats.minRttMs, rtt);
      job.stats.maxRttMs = job.stats.maxRttMs == null ? rtt : Math.max(job.stats.maxRttMs, rtt);
      job.stats.lastSuccessAt = now;
      job.lastCompletedAt = now;
      job.lastResult = Object.freeze({ ok: true, rttMs: rtt, transactionId: result?.transactionId ?? null });
      job.lastError = null;
      job.cycleAttempt = 0;
      job.state = job.enabled ? 'idle' : 'disabled';
      job.nextDueAt = now + job.intervalMs;
      this._emit('poll.job-success', job, { forced, rttMs: rtt });
      return result;
    } catch (error) {
      const now = this.clock();
      job.stats.failures += 1;
      if (error?.code === 'TIMEOUT') job.stats.timeouts += 1;
      if (error?.code === 'MODBUS_EXCEPTION') job.stats.exceptions += 1;
      job.stats.lastFailureAt = now;
      job.lastCompletedAt = now;
      job.lastError = { code: error?.code || null, message: String(error?.message || error), at: now };
      job.lastResult = Object.freeze({ ok: false, errorCode: error?.code || null });

      if (!forced && job.cycleAttempt < job.retries) {
        job.cycleAttempt += 1;
        job.stats.retries += 1;
        job.state = 'retry-wait';
        job.nextDueAt = now + job.retryDelayMs;
        this._emit('poll.job-retry', job, { attempt: job.cycleAttempt + 1, errorCode: error?.code || null });
      } else {
        job.cycleAttempt = 0;
        if (job.disableOnError && !forced) {
          job.enabled = false;
          job.state = 'disabled-error';
        } else {
          job.state = job.enabled ? 'idle' : 'disabled';
        }
        job.nextDueAt = now + job.intervalMs;
        this._emit('poll.job-failure', job, { forced, errorCode: error?.code || null, disabled: !job.enabled });
      }
      throw error;
    } finally {
      job.inFlight = false;
      this._wake();
    }
  }

  _validateTransportJob(job) {
    if (['rtu', 'ascii'].includes(this.master.framing)) {
      if (job.unitId < 1 || job.unitId > 247) {
        throw new PollSchedulerError('INVALID_SERIAL_POLL_UNIT', 'Cyclic RTU/ASCII poll jobs require a unicast Unit/Slave ID from 1..247', {
          unitId: job.unitId,
          framing: this.master.framing,
        });
      }
    }
  }

  _get(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new PollSchedulerError('JOB_NOT_FOUND', `Unknown poll job ${jobId}`, { jobId });
    return job;
  }

  _clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  _emit(type, job, details = {}) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'poll-scheduler',
      connectionId: this.master.connectionId || null,
      ownerMode: 'master',
      unitId: job.unitId,
      functionCode: job.pdu[0] ?? null,
      details: { jobId: job.jobId, label: job.label, state: job.state, ...details },
    }));
  }

  _emitScheduler(type) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'poll-scheduler',
      connectionId: this.master.connectionId || null,
      ownerMode: 'master',
      details: this.snapshot(),
    }));
  }
}

module.exports = {
  SAFE_POLL_FUNCTIONS,
  PollScheduler,
  PollSchedulerError,
  normalizeJob,
};
