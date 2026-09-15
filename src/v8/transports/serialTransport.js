'use strict';

const { EventEmitter } = require('node:events');
const { SerialPort } = require('serialport');
const { BoundedReceiveQueue, ReceiveQueueError } = require('./receiveQueue');
const { RtuIdleFramer, AsciiLineFramer, calculateRtuFrameGapMs } = require('./serialFramers');
const { ExactEchoSuppressor } = require('./echoSuppressor');

class SerialTransportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SerialTransportError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, SerialTransportError);
  }
}

function validateSerialOptions({ path, baudRate, dataBits, stopBits, parity, framing }) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path is required');
  if (!Number.isInteger(baudRate) || baudRate < 50) throw new TypeError('baudRate must be an integer >= 50');
  if (![5, 6, 7, 8].includes(dataBits)) throw new TypeError('dataBits must be 5..8');
  if (![1, 1.5, 2].includes(stopBits)) throw new TypeError('stopBits must be 1, 1.5 or 2');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new TypeError('unsupported parity');
  if (!['rtu', 'ascii'].includes(framing)) throw new TypeError('framing must be rtu or ascii');
}

function createNativePort(options) {
  return new SerialPort({ ...options, autoOpen: false });
}

function callbackMethod(target, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!target || typeof target[method] !== 'function') {
      reject(new SerialTransportError('UNSUPPORTED_DRIVER_OPERATION', `Serial driver does not implement ${method}()`));
      return;
    }
    target[method](...args, (error) => error ? reject(error) : resolve());
  });
}

async function listSerialPorts({ SerialPortClass = SerialPort } = {}) {
  if (!SerialPortClass || typeof SerialPortClass.list !== 'function') {
    throw new SerialTransportError('PORT_ENUMERATION_UNAVAILABLE', 'Serial driver does not support port enumeration');
  }
  const rows = await SerialPortClass.list();
  return Object.freeze((rows || []).map((row) => Object.freeze({
    path: row.path || null,
    manufacturer: row.manufacturer || null,
    serialNumber: row.serialNumber || null,
    pnpId: row.pnpId || null,
    locationId: row.locationId || null,
    vendorId: row.vendorId || null,
    productId: row.productId || null,
  })));
}

class SerialTransport extends EventEmitter {
  constructor({
    path,
    baudRate = 9600,
    dataBits = 8,
    stopBits = 1,
    parity = 'none',
    framing = 'rtu',
    rtscts = false,
    xon = false,
    xoff = false,
    xany = false,
    initialSignals = null,
    rtsTxMode = 'none',
    rtsSettleMs = 0,
    echoSuppression = false,
    writeTimeoutMs = 3000,
    maxQueuedFrames = 2048,
    maxQueuedBytes = 4 * 1024 * 1024,
    portFactory = createNativePort,
  } = {}) {
    super();
    validateSerialOptions({ path, baudRate, dataBits, stopBits, parity, framing });
    if (!['none', 'high-during-tx', 'low-during-tx'].includes(rtsTxMode)) throw new TypeError('rtsTxMode must be none, high-during-tx or low-during-tx');
    if (!Number.isFinite(rtsSettleMs) || rtsSettleMs < 0) throw new TypeError('rtsSettleMs must be >= 0');
    if (!Number.isFinite(writeTimeoutMs) || writeTimeoutMs <= 0) throw new TypeError('writeTimeoutMs must be > 0');
    if (typeof portFactory !== 'function') throw new TypeError('portFactory must be a function');

    this.path = path.trim();
    this.baudRate = baudRate;
    this.dataBits = dataBits;
    this.stopBits = stopBits;
    this.parity = parity;
    this.framing = framing;
    this.rtscts = Boolean(rtscts);
    this.xon = Boolean(xon);
    this.xoff = Boolean(xoff);
    this.xany = Boolean(xany);
    this.initialSignals = initialSignals && typeof initialSignals === 'object' ? { ...initialSignals } : null;
    this.rtsTxMode = rtsTxMode;
    this.rtsSettleMs = rtsSettleMs;
    this.echoSuppression = Boolean(echoSuppression);
    this.writeTimeoutMs = writeTimeoutMs;
    this.maxQueuedFrames = maxQueuedFrames;
    this.maxQueuedBytes = maxQueuedBytes;
    this.portFactory = portFactory;
    this.port = null;
    this.state = 'closed';
    this.closing = false;
    this.inbox = new BoundedReceiveQueue({ maxFrames: maxQueuedFrames, maxBytes: maxQueuedBytes });
    this.echo = new ExactEchoSuppressor({ enabled: echoSuppression });
    this.framer = this._createFramer();
    this._bindFramer();
    this.stats = {
      opens: 0,
      closes: 0,
      framesRx: 0,
      framesTx: 0,
      bytesRx: 0,
      bytesTx: 0,
      framingErrors: 0,
      queueOverflows: 0,
      driverErrors: 0,
      lastError: null,
      openedAt: null,
    };
    this.capabilities = Object.freeze({
      transport: framing === 'rtu' ? 'serial-rtu' : 'serial-ascii',
      duplex: true,
      stream: true,
      halfDuplexSafe: true,
      supportsAbort: true,
      supportsMatchedReceive: true,
      supportsRtsCts: true,
      supportsRtsTxToggle: true,
      supportsEchoSuppression: true,
    });
  }

  async open() {
    if (this.state === 'open') return this.status();
    if (this.state === 'opening') throw new SerialTransportError('ALREADY_OPENING', `${this.path} is already opening`);
    this.closing = false;
    this._prepareInbox();
    this.framer.reset();
    this.echo.cancel();
    this.state = 'opening';
    this._emitState();

    const options = {
      path: this.path,
      baudRate: this.baudRate,
      dataBits: this.dataBits,
      stopBits: this.stopBits,
      parity: this.parity,
      rtscts: this.rtscts,
      xon: this.xon,
      xoff: this.xoff,
      xany: this.xany,
    };
    const port = this.portFactory(options);
    if (!port || typeof port.on !== 'function') throw new SerialTransportError('INVALID_DRIVER', 'portFactory must return an EventEmitter-compatible serial port');
    this.port = port;
    this._bindPort(port);

    try {
      if (!port.isOpen) await callbackMethod(port, 'open');
      if (this.initialSignals) await this._setSignals(this.initialSignals);
      this.state = 'open';
      this.stats.opens += 1;
      this.stats.openedAt = Date.now();
      this.stats.lastError = null;
      this._emitState();
      return this.status();
    } catch (error) {
      this.stats.driverErrors += 1;
      this.stats.lastError = error.message;
      this.state = 'error';
      this._emitState({ error: error.message, errorCode: error.code || null });
      try { port.destroy?.(); } catch { /* ignore cleanup error */ }
      throw error instanceof SerialTransportError ? error : new SerialTransportError('OPEN_FAILED', error.message, { cause: error.code || null, path: this.path });
    }
  }

  async close() {
    if (this.state === 'closed') return this.status();
    this.closing = true;
    this.state = 'closing';
    this._emitState();
    const port = this.port;
    this.port = null;
    this.framer.reset();
    const recovered = this.echo.cancel();
    if (recovered.length) this.framer.push(recovered);
    if (port?.isOpen) {
      try { await callbackMethod(port, 'close'); } catch (error) {
        this.stats.driverErrors += 1;
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
      }
    }
    this.inbox.close(new SerialTransportError('CLOSED', `Serial port ${this.path} is closed`));
    this.state = 'closed';
    this.stats.closes += 1;
    this.stats.openedAt = null;
    this._emitState();
    return this.status();
  }

  async send(bytes) {
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new SerialTransportError('EMPTY_PAYLOAD', 'Cannot send an empty serial payload');
    const port = this.port;
    if (this.state !== 'open' || !port?.isOpen) throw new SerialTransportError('NOT_OPEN', `Serial port ${this.path} is not open`, { state: this.state });

    const activeRts = this.rtsTxMode === 'high-during-tx' ? true : this.rtsTxMode === 'low-during-tx' ? false : null;
    const idleRts = activeRts == null ? null : !activeRts;
    if (activeRts != null) {
      await this._setSignals({ rts: activeRts });
      await this._settle();
    }
    this.echo.arm(payload);

    try {
      await this._withTimeout(async () => {
        await callbackMethod(port, 'write', payload);
        await callbackMethod(port, 'drain');
      }, this.writeTimeoutMs, 'WRITE_TIMEOUT', `Serial write did not complete within ${this.writeTimeoutMs} ms`);
      this.stats.framesTx += 1;
      this.stats.bytesTx += payload.length;
      this.emit('tx', Buffer.from(payload));
    } catch (error) {
      const recovered = this.echo.cancel();
      if (recovered.length) this.framer.push(recovered);
      this.stats.driverErrors += 1;
      this.stats.lastError = error.message;
      throw error instanceof SerialTransportError ? error : new SerialTransportError('WRITE_FAILED', error.message, { cause: error.code || null });
    } finally {
      if (idleRts != null && this.port?.isOpen) {
        await this._settle();
        try { await this._setSignals({ rts: idleRts }); } catch (error) { this.emit('transport-error', error); }
      }
    }
  }

  receive(options = {}) {
    return this.inbox.receive(options);
  }

  async setSignals(signals) {
    if (this.state !== 'open') throw new SerialTransportError('NOT_OPEN', 'Serial port must be open to change modem signals');
    return this._setSignals(signals);
  }

  status() {
    return Object.freeze({
      state: this.state,
      path: this.path,
      framing: this.framing,
      baudRate: this.baudRate,
      dataBits: this.dataBits,
      stopBits: this.stopBits,
      parity: this.parity,
      rtscts: this.rtscts,
      rtsTxMode: this.rtsTxMode,
      echoSuppression: this.echoSuppression,
      frameGapMs: this.framing === 'rtu' ? calculateRtuFrameGapMs(this) : null,
      capabilities: this.capabilities,
      queue: this.inbox.snapshot(),
      echo: this.echo.snapshot(),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  _createFramer() {
    return this.framing === 'rtu'
      ? new RtuIdleFramer({ baudRate: this.baudRate, dataBits: this.dataBits, stopBits: this.stopBits, parity: this.parity })
      : new AsciiLineFramer();
  }

  _bindFramer() {
    this.framer.on('frame', (frame) => {
      try {
        this.inbox.push(frame, { path: this.path, framing: this.framing, receivedAt: Date.now() });
      } catch (error) {
        if (error instanceof ReceiveQueueError && error.code === 'RX_QUEUE_OVERFLOW') this.stats.queueOverflows += 1;
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        return;
      }
      this.stats.framesRx += 1;
      this.emit('rx', Buffer.from(frame));
    });
    this.framer.on('framing-error', (error) => {
      this.stats.framingErrors += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
    });
  }

  _bindPort(port) {
    port.on('data', (chunk) => {
      const incoming = Buffer.from(chunk ?? []);
      this.stats.bytesRx += incoming.length;
      const filtered = this.echo.filter(incoming);
      if (filtered.length) this.framer.push(filtered);
    });
    port.on('error', (error) => {
      this.stats.driverErrors += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
    });
    port.on('close', () => {
      if (port !== this.port && !this.closing) return;
      if (!this.closing) {
        this.state = 'error';
        this.stats.lastError = 'Serial port closed unexpectedly';
        this.inbox.close(new SerialTransportError('CONNECTION_LOST', `Serial port ${this.path} closed unexpectedly`));
        this._emitState({ error: this.stats.lastError });
      }
    });
  }

  async _setSignals(signals) {
    const port = this.port;
    if (!port || typeof port.set !== 'function') {
      throw new SerialTransportError('UNSUPPORTED_SIGNAL_CONTROL', 'Serial driver does not support signal control', { signals });
    }
    const allowed = ['brk', 'dtr', 'rts'];
    const normalized = {};
    for (const [key, value] of Object.entries(signals || {})) {
      if (!allowed.includes(key)) throw new SerialTransportError('UNSUPPORTED_SIGNAL', `Signal ${key} is not supported for output control`, { signal: key });
      normalized[key] = Boolean(value);
    }
    if (!Object.keys(normalized).length) return;
    await callbackMethod(port, 'set', normalized);
  }

  _prepareInbox() {
    if (!this.inbox || this.inbox.snapshot().closed) {
      this.inbox = new BoundedReceiveQueue({ maxFrames: this.maxQueuedFrames, maxBytes: this.maxQueuedBytes });
    }
  }

  _settle() {
    return this.rtsSettleMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.rtsSettleMs)) : Promise.resolve();
  }

  _withTimeout(task, timeoutMs, code, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new SerialTransportError(code, message));
      }, timeoutMs);
      Promise.resolve().then(task).then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  _emitState(details = {}) {
    this.emit('state', Object.freeze({ state: this.state, path: this.path, framing: this.framing, ...details }));
  }
}

module.exports = {
  SerialTransport,
  SerialTransportError,
  createNativePort,
  listSerialPorts,
  validateSerialOptions,
};
