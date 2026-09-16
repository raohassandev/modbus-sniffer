'use strict';

const tls = require('node:tls');
const net = require('node:net');
const { TcpClientTransport, TcpTransportError } = require('./tcpClientTransport');
const { TcpServerTransport } = require('./tcpServerTransport');

class TlsTransportError extends TcpTransportError {
  constructor(code, message, details = {}) {
    super(code, message, details);
    this.name = 'TlsTransportError';
  }
}

function normalizeMaterial(value, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new TlsTransportError('TLS_MATERIAL_REQUIRED', `${field} is required`, { field });
    return undefined;
  }
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeMaterial(entry, field, { required: true }));
  throw new TlsTransportError('INVALID_TLS_MATERIAL', `${field} must be a string, Buffer or array`, { field });
}

function normalizeClientTlsOptions({ ca = null, cert = null, key = null, servername = null, rejectUnauthorized = true, minVersion = 'TLSv1.2' } = {}) {
  if ((cert && !key) || (!cert && key)) throw new TlsTransportError('TLS_CLIENT_CERT_INCOMPLETE', 'Client certificate and key must be supplied together');
  return Object.freeze({
    ca: normalizeMaterial(ca, 'ca'),
    cert: normalizeMaterial(cert, 'cert'),
    key: normalizeMaterial(key, 'key'),
    servername: servername == null ? null : String(servername).trim() || null,
    rejectUnauthorized: rejectUnauthorized !== false,
    minVersion: String(minVersion || 'TLSv1.2'),
  });
}

function normalizeServerTlsOptions({ ca = null, cert, key, requestCert = false, rejectUnauthorized = false, minVersion = 'TLSv1.2' } = {}) {
  return Object.freeze({
    ca: normalizeMaterial(ca, 'ca'),
    cert: normalizeMaterial(cert, 'cert', { required: true }),
    key: normalizeMaterial(key, 'key', { required: true }),
    requestCert: Boolean(requestCert),
    rejectUnauthorized: Boolean(rejectUnauthorized),
    minVersion: String(minVersion || 'TLSv1.2'),
  });
}

class TlsClientTransport extends TcpClientTransport {
  constructor({
    ca = null,
    cert = null,
    key = null,
    servername = null,
    rejectUnauthorized = true,
    minVersion = 'TLSv1.2',
    connectFactory = tls.connect,
    ...options
  } = {}) {
    super({ port: 802, ...options });
    if (typeof connectFactory !== 'function') throw new TypeError('connectFactory must be a function');
    this.tlsOptions = normalizeClientTlsOptions({ ca, cert, key, servername, rejectUnauthorized, minVersion });
    this.connectFactory = connectFactory;
    this.capabilities = Object.freeze({
      ...this.capabilities,
      transport: 'tls-client',
      secure: true,
      nativeMbap: true,
      failClosed: true,
    });
  }

  status() {
    const socket = this.socket;
    let cipher = null;
    let protocol = null;
    try { cipher = socket?.getCipher?.() || null; } catch { /* diagnostics only */ }
    try { protocol = socket?.getProtocol?.() || null; } catch { /* diagnostics only */ }
    return Object.freeze({
      ...super.status(),
      tls: Object.freeze({
        servername: this.tlsOptions.servername || (net.isIP(this.host) ? null : this.host),
        rejectUnauthorized: this.tlsOptions.rejectUnauthorized,
        minVersion: this.tlsOptions.minVersion,
        authorized: socket?.authorized ?? null,
        authorizationError: socket?.authorizationError || null,
        protocol,
        cipher,
      }),
    });
  }

  async _connectOnce(isReconnect) {
    this.state = isReconnect ? 'reconnecting' : 'opening';
    this._emitState();
    this.framer.reset();

    return new Promise((resolve, reject) => {
      let settled = false;
      let connectTimer = null;
      let socket = null;
      const failConnect = (error) => {
        if (settled) return;
        settled = true;
        if (connectTimer) clearTimeout(connectTimer);
        socket?.destroy?.();
        const wrapped = error instanceof TcpTransportError
          ? error
          : new TlsTransportError('TLS_CONNECT_FAILED', error?.message || String(error), { cause: error?.code || null });
        this.stats.lastError = wrapped.message;
        this.state = 'error';
        this._emitState({ error: wrapped.message });
        reject(wrapped);
      };

      const options = {
        host: this.host,
        port: this.port,
        rejectUnauthorized: this.tlsOptions.rejectUnauthorized,
        minVersion: this.tlsOptions.minVersion,
      };
      if (this.localAddress) options.localAddress = this.localAddress;
      if (this.family) options.family = this.family;
      const servername = this.tlsOptions.servername || (net.isIP(this.host) ? null : this.host);
      if (servername) options.servername = servername;
      if (this.tlsOptions.ca !== undefined) options.ca = this.tlsOptions.ca;
      if (this.tlsOptions.cert !== undefined) options.cert = this.tlsOptions.cert;
      if (this.tlsOptions.key !== undefined) options.key = this.tlsOptions.key;

      try {
        socket = this.connectFactory(options, () => {
          if (settled) return;
          settled = true;
          if (connectTimer) clearTimeout(connectTimer);
          this.state = 'open';
          this.stats.connects += 1;
          if (isReconnect) this.stats.reconnects += 1;
          this.stats.connectedAt = Date.now();
          this.stats.lastError = null;
          this._emitState();
          resolve(this.status());
        });
      } catch (error) {
        failConnect(error);
        return;
      }

      this.socket = socket;
      socket.setNoDelay?.(true);
      socket.setKeepAlive?.(true);
      if (this.idleTimeoutMs > 0) {
        socket.setTimeout?.(this.idleTimeoutMs, () => socket.destroy(new TlsTransportError('IDLE_TIMEOUT', `TLS connection idle for ${this.idleTimeoutMs} ms`)));
      }
      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', (hadError) => this._onClose(socket, hadError));
      socket.on('error', (error) => {
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        if (!settled) failConnect(error);
      });
      connectTimer = setTimeout(() => {
        failConnect(new TlsTransportError('TLS_CONNECT_TIMEOUT', `TLS connect timed out after ${this.connectTimeoutMs} ms`, { host: this.host, port: this.port }));
      }, this.connectTimeoutMs);
    });
  }
}

class TlsServerTransport extends TcpServerTransport {
  constructor({
    ca = null,
    cert,
    key,
    requestCert = false,
    rejectUnauthorized = false,
    minVersion = 'TLSv1.2',
    createServerFactory = tls.createServer,
    ...options
  } = {}) {
    super({ port: 802, ...options });
    if (typeof createServerFactory !== 'function') throw new TypeError('createServerFactory must be a function');
    this.tlsOptions = normalizeServerTlsOptions({ ca, cert, key, requestCert, rejectUnauthorized, minVersion });
    this.createServerFactory = createServerFactory;
    this.capabilities = Object.freeze({
      ...this.capabilities,
      transport: 'tls-server',
      secure: true,
      nativeMbap: true,
      failClosed: true,
      mutualTls: this.tlsOptions.requestCert && this.tlsOptions.rejectUnauthorized,
    });
  }

  async open() {
    if (this.state === 'open') return this.status();
    if (this.state === 'opening') throw new TlsTransportError('ALREADY_OPENING', 'TLS server is already opening');
    this._prepareInbox();
    this.state = 'opening';
    this._emitState();
    const options = {
      cert: this.tlsOptions.cert,
      key: this.tlsOptions.key,
      requestCert: this.tlsOptions.requestCert,
      rejectUnauthorized: this.tlsOptions.rejectUnauthorized,
      minVersion: this.tlsOptions.minVersion,
    };
    if (this.tlsOptions.ca !== undefined) options.ca = this.tlsOptions.ca;
    const server = this.createServerFactory(options, (socket) => this._accept(socket));
    this.server = server;

    return new Promise((resolve, reject) => {
      let settled = false;
      const onError = (error) => {
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        if (!settled) {
          settled = true;
          this.state = 'error';
          reject(new TlsTransportError('TLS_LISTEN_FAILED', error.message, { cause: error.code || null, host: this.host, port: this.port }));
        }
      };
      server.on('error', onError);
      server.once('listening', () => {
        if (settled) return;
        settled = true;
        this.state = 'open';
        this.stats.listeningAt = Date.now();
        this.stats.lastError = null;
        this._emitState();
        resolve(this.status());
      });
      server.listen({ host: this.host, port: this.port });
    });
  }

  status() {
    return Object.freeze({
      ...super.status(),
      tls: Object.freeze({
        requestCert: this.tlsOptions.requestCert,
        rejectUnauthorized: this.tlsOptions.rejectUnauthorized,
        minVersion: this.tlsOptions.minVersion,
        mutualTls: this.tlsOptions.requestCert && this.tlsOptions.rejectUnauthorized,
      }),
    });
  }
}

module.exports = {
  TlsTransportError,
  TlsClientTransport,
  TlsServerTransport,
  normalizeClientTlsOptions,
  normalizeServerTlsOptions,
};
