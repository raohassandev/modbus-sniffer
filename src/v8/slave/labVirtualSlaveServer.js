'use strict';

const { VirtualSlaveServer, WRITE_FUNCTIONS, SERIAL_BROADCAST_WRITE_FUNCTIONS } = require('./virtualSlaveServer');
const { FaultInjectionLab, corruptChecksum } = require('./faultInjectionLab');

const sleep = (ms) => ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

class LabVirtualSlaveServer extends VirtualSlaveServer {
  constructor(options = {}) {
    super(options);
    this.faultLab = options.faultLab instanceof FaultInjectionLab ? options.faultLab : new FaultInjectionLab();
    this.maxWriteAuditEntries = Number.isInteger(options.maxWriteAuditEntries) && options.maxWriteAuditEntries > 0 ? options.maxWriteAuditEntries : 10000;
    this.writeAudit = [];
    this.writeAuditSequence = 0;
    this.clientSessions = new Map();
    this.lastRequest = null;
  }

  armFaultLab(policy, confirmation = {}) {
    const snapshot = this.faultLab.arm(policy, confirmation);
    this._emitTraffic('slave.fault-lab-armed', null, null, { policy: snapshot.policy });
    return snapshot;
  }

  disarmFaultLab() {
    const snapshot = this.faultLab.disarm();
    this._emitTraffic('slave.fault-lab-disarmed', null, null, {});
    return snapshot;
  }

  getWriteAudit({ limit = this.maxWriteAuditEntries } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, this.maxWriteAuditEntries) : this.maxWriteAuditEntries;
    return Object.freeze(this.writeAudit.slice(-safeLimit));
  }

  listClientSessions() {
    return Object.freeze([...this.clientSessions.values()].map((entry) => Object.freeze({ ...entry })));
  }

  snapshot() {
    return Object.freeze({
      ...super.snapshot(),
      faultLab: this.faultLab.snapshot(),
      writeAuditCount: this.writeAudit.length,
      clientSessions: this.listClientSessions(),
      lastRequest: this.lastRequest ? Object.freeze({ ...this.lastRequest }) : null,
    });
  }

  async _handleAdu(raw, route = null) {
    let request;
    try {
      request = this._decodeAdu(raw);
    } catch (error) {
      this.stats.malformed++;
      this._emitTraffic('slave.malformed', null, raw, { errorCode: error?.code || null, error: error.message, clientId: route?.clientId || null });
      return;
    }

    this.stats.requests++;
    const functionCode = request.pdu[0];
    this.lastRequest = {
      at: Date.now(),
      unitId: request.unitId,
      functionCode,
      clientId: route?.clientId || null,
      rawHex: Buffer.from(raw).toString('hex').toUpperCase(),
    };
    this._trackClient(route);
    this._emitTraffic('traffic.rx', request.unitId, raw, {
      functionCode,
      framing: this.framing,
      clientId: route?.clientId || null,
      transactionId: request.transactionId ?? null,
    });
    if (WRITE_FUNCTIONS.has(functionCode)) this._appendWriteAudit({ request, raw, route });

    const isSerialBroadcast = (this.framing === 'rtu' || this.framing === 'ascii') && request.unitId === 0;
    if (isSerialBroadcast) {
      this.stats.broadcasts++;
      const supported = SERIAL_BROADCAST_WRITE_FUNCTIONS.has(functionCode);
      if (supported) {
        for (const device of this.devices.values()) this._processPdu(device, request.pdu, { broadcast: true });
      }
      this._emitTraffic('slave.broadcast', 0, raw, { functionCode, applied: supported });
      return;
    }

    const device = this.devices.get(request.unitId);
    if (!device) {
      this.stats.silentUnknownUnits++;
      this._emitTraffic('slave.unknown-unit', request.unitId, raw, { functionCode, clientId: route?.clientId || null });
      return;
    }

    let responsePdu = this._processPdu(device, request.pdu, { broadcast: false });
    if (!responsePdu) return;
    const fault = this.faultLab.decide();
    if (fault.forceExceptionCode != null) responsePdu = this._exception(functionCode, fault.forceExceptionCode);
    if (fault.wrongFunctionCode != null) {
      responsePdu = Buffer.from(responsePdu);
      responsePdu[0] = fault.wrongFunctionCode;
    }
    if (responsePdu[0] & 0x80) this.stats.exceptions++;

    const responseUnitId = fault.wrongUnitId == null ? request.unitId : fault.wrongUnitId;
    let response = this._encodeAdu(request, responseUnitId, responsePdu);
    if (fault.corruptChecksum) response = corruptChecksum(response, this.framing);
    if (fault.truncateBytes > 0 && response.length > fault.truncateBytes) response = Buffer.from(response.subarray(0, response.length - fault.truncateBytes));

    if (fault.delayMs > 0) await sleep(fault.delayMs);
    if (fault.drop) {
      this._emitTraffic('slave.fault-drop', request.unitId, response, { functionCode: responsePdu[0], labSequence: fault.sequence });
      return;
    }

    await this.broker.transmit(this.connectionId, {
      ownerId: this.ownerId,
      bytes: response,
      intent: 'response',
      route,
    });
    this.stats.responses++;
    this._emitTraffic('traffic.tx', responseUnitId, response, {
      functionCode: responsePdu[0],
      framing: this.framing,
      exception: Boolean(responsePdu[0] & 0x80),
      clientId: route?.clientId || null,
      transactionId: request.transactionId ?? null,
      faultLab: fault.enabled ? fault : null,
    });

    if (fault.duplicate) {
      await this.broker.transmit(this.connectionId, { ownerId: this.ownerId, bytes: response, intent: 'response', route });
      this.stats.responses++;
      this._emitTraffic('slave.fault-duplicate', responseUnitId, response, { functionCode: responsePdu[0], labSequence: fault.sequence });
    }
  }

  _trackClient(route) {
    if (!route?.clientId) return;
    const current = this.clientSessions.get(route.clientId) || {
      clientId: route.clientId,
      remoteAddress: route.remoteAddress || null,
      remotePort: route.remotePort || null,
      connectedAt: Date.now(),
      requests: 0,
      lastSeenAt: null,
    };
    current.requests += 1;
    current.lastSeenAt = Date.now();
    this.clientSessions.set(route.clientId, current);
  }

  _appendWriteAudit({ request, raw, route }) {
    const record = Object.freeze({
      auditId: `slave-write-${++this.writeAuditSequence}`,
      timestamp: Date.now(),
      connectionId: this.connectionId,
      unitId: request.unitId,
      functionCode: request.pdu[0],
      broadcast: request.unitId === 0 && ['rtu', 'ascii'].includes(this.framing),
      clientId: route?.clientId || null,
      remoteAddress: route?.remoteAddress || null,
      remotePort: route?.remotePort || null,
      rawHex: Buffer.from(raw).toString('hex').toUpperCase(),
    });
    this.writeAudit.push(record);
    if (this.writeAudit.length > this.maxWriteAuditEntries) this.writeAudit.splice(0, this.writeAudit.length - this.maxWriteAuditEntries);
    this.emit('write-audit', record);
    this._emitTraffic('slave.write-observed', request.unitId, raw, { functionCode: request.pdu[0], auditId: record.auditId, clientId: record.clientId });
  }
}

module.exports = { LabVirtualSlaveServer };
