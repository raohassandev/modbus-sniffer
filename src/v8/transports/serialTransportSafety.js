'use strict';

const base = require('./serialTransport');

function callbackMethod(target, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!target || typeof target[method] !== 'function') {
      reject(new base.SerialTransportError('UNSUPPORTED_DRIVER_OPERATION', `Serial driver does not implement ${method}()`));
      return;
    }
    try {
      target[method](...args, (error) => error ? reject(error) : resolve());
    } catch (error) {
      reject(error);
    }
  });
}

class SerialTransport extends base.SerialTransport {
  constructor(options = {}) {
    super(options);
    this.txQueue = Promise.resolve();
    this.pendingTransmissions = 0;
    this.activeTransmission = false;
    this.txOutcomeUnknown = false;
    if (!Object.prototype.hasOwnProperty.call(this.stats, 'ambiguousTransmissions')) {
      this.stats.ambiguousTransmissions = 0;
    }
  }

  async open() {
    if (this.txOutcomeUnknown && this.port?.isOpen) {
      throw new base.SerialTransportError(
        'CLOSE_REQUIRED_AFTER_AMBIGUOUS_TX',
        'Close the serial transport before reopening after an ambiguous transmission outcome',
        { path: this.path },
      );
    }
    const status = await super.open();
    this.txOutcomeUnknown = false;
    return this.status();
  }

  send(bytes) {
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) {
      return Promise.reject(new base.SerialTransportError('EMPTY_PAYLOAD', 'Cannot send an empty serial payload'));
    }

    this.pendingTransmissions += 1;
    const task = this.txQueue.then(() => this._sendSerialized(payload));
    const settled = task.finally(() => {
      this.pendingTransmissions = Math.max(0, this.pendingTransmissions - 1);
    });
    this.txQueue = settled.catch(() => undefined);
    return task;
  }

  async close() {
    // Stop admitting queued work, allow the currently executing TX attempt to settle,
    // then close the driver. Queued attempts will fail fast because `closing` is set.
    this.closing = true;
    await this.txQueue.catch(() => undefined);
    return super.close();
  }

  status() {
    const status = super.status();
    return Object.freeze({
      ...status,
      transmitQueue: Object.freeze({
        pending: this.pendingTransmissions,
        active: this.activeTransmission,
      }),
      txOutcomeUnknown: this.txOutcomeUnknown,
    });
  }

  async _sendSerialized(payload) {
    if (this.closing) {
      throw new base.SerialTransportError('CLOSING', `Serial port ${this.path} is closing`, {
        path: this.path,
        mayHaveTransmitted: false,
      });
    }

    const port = this.port;
    if (this.state !== 'open' || !port?.isOpen) {
      throw new base.SerialTransportError('NOT_OPEN', `Serial port ${this.path} is not open`, {
        state: this.state,
        mayHaveTransmitted: false,
      });
    }

    this.activeTransmission = true;
    let writeInvoked = false;
    let stage = 'direction-control';
    const rawHex = payload.toString('hex').toUpperCase();
    const activeRts = this.rtsTxMode === 'high-during-tx' ? true : this.rtsTxMode === 'low-during-tx' ? false : null;
    const idleRts = activeRts == null ? null : !activeRts;

    try {
      if (activeRts != null) {
        await this._setSignals({ rts: activeRts });
        await this._settle();
      }

      this.echo.arm(payload);
      stage = 'driver-write';
      writeInvoked = true;
      await this._withTimeout(
        () => callbackMethod(port, 'write', payload),
        this.writeTimeoutMs,
        'WRITE_TIMEOUT',
        `Serial driver write did not complete within ${this.writeTimeoutMs} ms`,
      );

      stage = 'driver-drain';
      await this._withTimeout(
        () => callbackMethod(port, 'drain'),
        this.writeTimeoutMs,
        'DRAIN_TIMEOUT',
        `Serial driver drain did not complete within ${this.writeTimeoutMs} ms`,
      );

      this.stats.framesTx += 1;
      this.stats.bytesTx += payload.length;
      this.emit('tx', Buffer.from(payload));
      return payload.length;
    } catch (error) {
      const recovered = this.echo.cancel();
      if (recovered.length) this.framer.push(recovered);
      this.stats.driverErrors += 1;
      this.stats.lastError = String(error?.message || error);

      if (writeInvoked) {
        this.stats.ambiguousTransmissions += 1;
        this.txOutcomeUnknown = true;
        this.state = 'error';
        const ambiguous = new base.SerialTransportError(
          'TRANSMISSION_OUTCOME_UNKNOWN',
          'Serial transmission outcome is unknown after the driver write was attempted; do not retry automatically',
          {
            causeCode: error?.code || null,
            causeMessage: String(error?.message || error),
            stage,
            mayHaveTransmitted: true,
            rawHex,
            path: this.path,
          },
        );
        this._emitState({ error: ambiguous.message, errorCode: ambiguous.code, stage });
        throw ambiguous;
      }

      if (error instanceof base.SerialTransportError) {
        error.details = {
          ...(error.details || {}),
          stage,
          mayHaveTransmitted: false,
          rawHex,
          path: this.path,
        };
        throw error;
      }

      throw new base.SerialTransportError('WRITE_FAILED', String(error?.message || error), {
        causeCode: error?.code || null,
        stage,
        mayHaveTransmitted: false,
        rawHex,
        path: this.path,
      });
    } finally {
      if (idleRts != null && this.port?.isOpen) {
        await this._settle();
        try {
          await this._setSignals({ rts: idleRts });
        } catch (error) {
          this.emit('transport-error', error);
        }
      }
      this.activeTransmission = false;
    }
  }
}

module.exports = {
  ...base,
  BaseSerialTransport: base.SerialTransport,
  SerialTransport,
};
