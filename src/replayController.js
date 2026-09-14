'use strict';

function eventSourceTime(event, fallback = 0) {
  const value = Number(event?.sourceTimestamp ?? event?.timestamp);
  return Number.isFinite(value) ? value : fallback;
}

class ReplayController {
  constructor(state) {
    this.state = state;
    this.capture = null;
    this.timer = null;
    this.index = 0;
    this.speed = 1;
    this.running = false;
    this.startedAt = null;
    this.sourceStartedAt = null;
    this.analysisStartedAt = null;
  }

  load(capture) {
    if (!capture || !Array.isArray(capture.transactions)) throw new Error('Invalid .mbcap capture.');
    this.stop();
    this.capture = capture;
    this.index = 0;
    return this.status();
  }

  start({ speed = 1 } = {}) {
    if (!this.capture) throw new Error('Load a capture before replay.');
    this.stop();
    this.speed = Math.max(0.1, Math.min(20, Number(speed) || 1));
    this.index = 0;
    this.running = true;
    this.startedAt = Date.now();
    this.analysisStartedAt = this.startedAt;
    this.sourceStartedAt = this.capture.transactions.length ? eventSourceTime(this.capture.transactions[0], 0) : 0;
    this.state.clearCapture();
    for (const channel of this.capture.channels || []) this.state.registerChannel?.(channel);
    this.state.setCaptureSource('replay');
    this.state.setConnection('replay', { path: 'CAPTURE', message: `Replay ${this.speed}x` });
    this._step();
    return this.status();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    const wasRunning = this.running;
    this.running = false;
    if (wasRunning) this.state.setConnection('idle', { path: null, message: 'Replay stopped' });
  }

  _analysisTimestamp(event) {
    const source = eventSourceTime(event, this.sourceStartedAt || 0);
    return Number(this.analysisStartedAt || Date.now()) + Math.max(0, source - Number(this.sourceStartedAt || source));
  }

  _ingest(event) {
    const sourceTimestamp = eventSourceTime(event, this.sourceStartedAt || Date.now());
    const analysisTimestamp = this._analysisTimestamp(event);
    const replayTimestamp = Date.now();
    const enriched = { ...event, sourceTimestamp, replayTimestamp };
    if (event.direction === 'TIMEOUT' || event.timeout) {
      const request = { ...(event.request || event.decoded || {}), sourceTimestamp, replayTimestamp };
      const out = this.state.recordTimeout?.(request, analysisTimestamp, Number(event.timeoutMs) || 1000, event.transport || request.transport || 'RTU');
      if (out) { out.sourceTimestamp = sourceTimestamp; out.replayTimestamp = replayTimestamp; }
      return out;
    }
    return this.state.ingestImportedEvent(enriched, analysisTimestamp, true);
  }

  _step() {
    if (!this.running || !this.capture) return;
    const events = this.capture.transactions;
    if (this.index >= events.length) {
      this.running = false;
      this.timer = null;
      this.state.setConnection('idle', { path: null, message: 'Replay complete' });
      return;
    }
    const current = events[this.index];
    const previous = this.index > 0 ? events[this.index - 1] : current;
    const sourceDelta = Math.max(0, eventSourceTime(current) - eventSourceTime(previous));
    const delay = this.index === 0 ? 0 : Math.max(0, Math.min(30000, sourceDelta / this.speed));
    this.timer = setTimeout(() => {
      if (!this.running) return;
      this._ingest(current);
      this.index++;
      this._step();
    }, delay);
  }

  status() {
    return {
      loaded: Boolean(this.capture),
      running: this.running,
      speed: this.speed,
      index: this.index,
      total: this.capture?.transactions?.length || 0,
      createdAt: this.capture?.createdAt || null,
      startedAt: this.startedAt,
      sourceStartedAt: this.sourceStartedAt,
      analysisStartedAt: this.analysisStartedAt,
      timingMode: 'source-preserved'
    };
  }
}

module.exports = { ReplayController, eventSourceTime };
