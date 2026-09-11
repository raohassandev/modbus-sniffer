'use strict';

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');
const { buildIdentity, findReboundPort } = require('./portIdentity');

class PortManager extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.port = null;
    this.stopping = false;
    this.retryTimer = null;
    this.currentPath = options.port;
    this.identity = null;
  }

  static async list() {
    return SerialPort.list();
  }

  async start() {
    this.stopping = false;
    await this._captureIdentity();
    await this._open();
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const p = this.port;
    this.port = null;
    if (p?.isOpen) await new Promise(resolve => p.close(() => resolve()));
  }

  async _captureIdentity() {
    try {
      const ports = await SerialPort.list();
      const selected = ports.find(p => p.path.toLowerCase() === String(this.currentPath).toLowerCase());
      if (selected) {
        this.identity = buildIdentity(selected);
        this.emit('identity', this.identity);
      }
    } catch (err) {
      this.emit('scan-error', err);
    }
  }

  async _resolvePath() {
    let ports;
    try {
      ports = await SerialPort.list();
    } catch (err) {
      this.emit('scan-error', err);
      return this.currentPath;
    }

    const exact = ports.find(p => p.path.toLowerCase() === String(this.currentPath).toLowerCase());
    if (exact) return exact.path;

    if (!this.options.autoRebind || !this.identity) return this.currentPath;

    const rebound = findReboundPort(ports, this.identity);
    if (!rebound) return this.currentPath;

    const oldPath = this.currentPath;
    this.currentPath = rebound.path;
    this.options.port = rebound.path;
    this.emit('rebound', oldPath, rebound.path, rebound);
    return rebound.path;
  }

  _scheduleRetry(reason) {
    if (this.stopping || this.retryTimer) return;
    this.emit('retry', reason, this.options.reconnectMs);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      await this._open();
    }, this.options.reconnectMs);
  }

  async _open() {
    if (this.stopping || this.port?.isOpen) return;

    const o = this.options;
    const path = await this._resolvePath();
    if (this.stopping) return;

    const port = new SerialPort({
      path,
      baudRate: o.baudRate,
      dataBits: o.dataBits,
      stopBits: o.stopBits,
      parity: o.parity,
      autoOpen: false
    });
    this.port = port;

    port.on('data', data => this.emit('data', data));
    port.on('error', err => {
      this.emit('port-error', err);
      if (!this.stopping && !port.isOpen) this._scheduleRetry(err);
    });
    port.on('close', err => {
      this.emit('close', err, path);
      if (!this.stopping) this._scheduleRetry(err || new Error('Port closed'));
    });

    port.open(err => {
      if (err) {
        this.emit('open-error', err, path);
        this._scheduleRetry(err);
        return;
      }
      this.currentPath = path;
      if (!this.identity) this._captureIdentity();
      this.emit('open', port, path);
    });
  }
}

module.exports = { PortManager };
