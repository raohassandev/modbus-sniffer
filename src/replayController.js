'use strict';

class ReplayController {
  constructor(state) {
    this.state = state;
    this.capture = null;
    this.timer = null;
    this.index = 0;
    this.speed = 1;
    this.running = false;
    this.startedAt = null;
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
    this.state.clearCapture();
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
    const delay = this.index === 0 ? 0 : Math.max(0, Math.min(30000, (Number(current.timestamp) - Number(previous.timestamp)) / this.speed));
    this.timer = setTimeout(() => {
      if (!this.running) return;
      this.state.ingestImportedEvent(current, Date.now(), true);
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
      startedAt: this.startedAt
    };
  }
}

module.exports = { ReplayController };
