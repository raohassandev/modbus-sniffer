'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');
const { VirtualDevice, VirtualDeviceError } = require('./virtualDevice');

const WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
  protocol.FC.WRITE_FILE_RECORD,
  protocol.FC.MASK_WRITE_REGISTER,
  protocol.FC.READ_WRITE_MULTIPLE_REGISTERS,
]);

const SERIAL_BROADCAST_WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
]);

class VirtualSlaveServer extends EventEmitter {
  constructor({
    broker,
    connectionId,
    ownerId = 'v8-virtual-slave',
    framing = 'rtu',
    receivePollMs = 25,
  }) {
    super();
    if (!broker) throw new TypeError('broker is required');
    if (!connectionId) throw new TypeError('connectionId is required');
    if (!['rtu', 'ascii', 'tcp'].includes(framing)) throw new TypeError('framing must be rtu, ascii or tcp');
    this.broker = broker;
    this.connectionId = connectionId;
    this.ownerId = ownerId;
    this.framing = framing;
    this.receivePollMs = receivePollMs;
    this.devices = new Map();
    this.running = false;
    this.loopPromise = null;
    this.stats = {
      requests: 0,
      responses: 0,
      broadcasts: 0,
      silentUnknownUnits: 0,
      exceptions: 0,
      malformed: 0,
      runtimeErrors: 0,
    };
  }

  addDevice(deviceOrOptions) {
    const device = deviceOrOptions instanceof VirtualDevice ? deviceOrOptions : new VirtualDevice(deviceOrOptions);
    if (['rtu', 'ascii'].includes(this.framing) && device.unitId > 247) {
      throw new VirtualDeviceError('INVALID_SERIAL_UNIT_ID', 'RTU/ASCII virtual Slave Unit ID must be 1..247', 3, {
        unitId: device.unitId,
        framing: this.framing,
      });
    }
    if (this.devices.has(device.unitId)) throw new Error(`Virtual Unit ${device.unitId} already exists`);
    this.devices.set(device.unitId, device);
    return device;
  }

  removeDevice(unitId) {
    return this.devices.delete(unitId);
  }

  getDevice(unitId) {
    return this.devices.get(unitId) || null;
  }

  async start() {
    if (this.running) return;
    const status = this.broker.getConnection(this.connectionId);
    if (status.state !== 'open' || (status.transportState !== 'open' && status.transportState !== 'unknown')) {
      await this.broker.open(this.connectionId, { ownerMode: 'slave', ownerId: this.ownerId });
    } else if (status.owner?.ownerMode !== 'slave' || status.owner?.ownerId !== this.ownerId) {
      throw new Error(`Connection ${this.connectionId} is not owned by this Slave server`);
    }
    this.running = true;
    this.loopPromise = this._loop();
  }

  async stop({ closeConnection = false } = {}) {
    this.running = false;
    if (this.loopPromise) await this.loopPromise;
    this.loopPromise = null;
    if (closeConnection) {
      const status = this.broker.getConnection(this.connectionId);
      if (status.state === 'open' || status.state === 'error') await this.broker.close(this.connectionId, { ownerId: this.ownerId });
      const afterClose = this.broker.getConnection(this.connectionId);
      if (afterClose.owner?.ownerId === this.ownerId) this.broker.release(this.connectionId, { ownerId: this.ownerId });
    }
  }

  snapshot() {
    return Object.freeze({
      running: this.running,
      framing: this.framing,
      connectionId: this.connectionId,
      unitIds: Object.freeze([...this.devices.keys()].sort((a, b) => a - b)),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  async _loop() {
    while (this.running) {
      let raw;
      let route = null;
      try {
        const received = await this.broker.receive(this.connectionId, {
          ownerId: this.ownerId,
          timeoutMs: this.receivePollMs,
          withMeta: true,
        });
        raw = received.bytes;
        route = received.meta;
      } catch (error) {
        if (error?.code === 'TIMEOUT') continue;
        if (!this.running && ['NOT_OPEN', 'CONNECTION_NOT_OPEN', 'ABORTED', 'CLOSED'].includes(error?.code)) break;
        this._emitRuntimeError(error, 'receive');
        continue;
      }

      try {
        await this._handleAdu(raw, route);
      } catch (error) {
        this._emitRuntimeError(error, 'handle');
      }
    }
  }

  _decodeAdu(raw) {
    if (this.framing === 'rtu') return protocol.decodeRtuAdu(raw);
    if (this.framing === 'ascii') return protocol.decodeAsciiAdu(raw);
    return protocol.decodeTcpAdu(raw);
  }

  _encodeAdu(context, unitId, pdu) {
    if (this.framing === 'rtu') return protocol.encodeRtuAdu(unitId, pdu);
    if (this.framing === 'ascii') return protocol.encodeAsciiAdu(unitId, pdu);
    return protocol.encodeTcpAdu({
      transactionId: context.transactionId,
      protocolId: context.protocolId,
      unitId,
      pdu,
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
    this._emitTraffic('traffic.rx', request.unitId, raw, {
      functionCode,
      framing: this.framing,
      clientId: route?.clientId || null,
      transactionId: request.transactionId ?? null,
    });

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

    const responsePdu = this._processPdu(device, request.pdu, { broadcast: false });
    if (!responsePdu) return;
    if (responsePdu[0] & 0x80) this.stats.exceptions++;

    const response = this._encodeAdu(request, request.unitId, responsePdu);
    await this.broker.transmit(this.connectionId, {
      ownerId: this.ownerId,
      bytes: response,
      intent: 'response',
      route,
    });
    this.stats.responses++;
    this._emitTraffic('traffic.tx', request.unitId, response, {
      functionCode: responsePdu[0],
      framing: this.framing,
      exception: Boolean(responsePdu[0] & 0x80),
      clientId: route?.clientId || null,
      transactionId: request.transactionId ?? null,
    });
  }

  _processPdu(device, pdu, { broadcast }) {
    const functionCode = pdu[0];
    try {
      switch (functionCode) {
        case protocol.FC.READ_COILS: {
          if (broadcast) return null;
          const request = protocol.decodeReadRequest(pdu);
          const values = device.read('coils', request.address, request.quantity);
          return protocol.encodeReadBitsResponse({ functionCode, values });
        }
        case protocol.FC.READ_DISCRETE_INPUTS: {
          if (broadcast) return null;
          const request = protocol.decodeReadRequest(pdu);
          const values = device.read('discreteInputs', request.address, request.quantity);
          return protocol.encodeReadBitsResponse({ functionCode, values });
        }
        case protocol.FC.READ_HOLDING_REGISTERS: {
          if (broadcast) return null;
          const request = protocol.decodeReadRequest(pdu);
          const values = device.read('holdingRegisters', request.address, request.quantity);
          return protocol.encodeReadRegistersResponse({ functionCode, values });
        }
        case protocol.FC.READ_INPUT_REGISTERS: {
          if (broadcast) return null;
          const request = protocol.decodeReadRequest(pdu);
          const values = device.read('inputRegisters', request.address, request.quantity);
          return protocol.encodeReadRegistersResponse({ functionCode, values });
        }
        case protocol.FC.WRITE_SINGLE_COIL: {
          const request = protocol.decodeWriteSingleRequest(pdu);
          device.write('coils', request.address, [request.value]);
          return broadcast ? null : Buffer.from(pdu);
        }
        case protocol.FC.WRITE_SINGLE_REGISTER: {
          const request = protocol.decodeWriteSingleRequest(pdu);
          device.write('holdingRegisters', request.address, [request.value]);
          return broadcast ? null : Buffer.from(pdu);
        }
        case protocol.FC.WRITE_MULTIPLE_COILS: {
          const request = protocol.decodeWriteMultipleRequest(pdu);
          device.write('coils', request.address, request.values);
          return broadcast ? null : protocol.encodeWriteMultipleResponse({
            functionCode,
            address: request.address,
            quantity: request.quantity,
          });
        }
        case protocol.FC.WRITE_MULTIPLE_REGISTERS: {
          const request = protocol.decodeWriteMultipleRequest(pdu);
          device.write('holdingRegisters', request.address, request.values);
          return broadcast ? null : protocol.encodeWriteMultipleResponse({
            functionCode,
            address: request.address,
            quantity: request.quantity,
          });
        }
        case protocol.FC.MASK_WRITE_REGISTER: {
          if (broadcast) return null;
          const request = protocol.decodeMaskWriteRegisterRequest(pdu);
          const current = device.read('holdingRegisters', request.address, 1)[0];
          const result = ((current & request.andMask) | (request.orMask & (~request.andMask & 0xFFFF))) & 0xFFFF;
          device.write('holdingRegisters', request.address, [result]);
          return Buffer.from(pdu);
        }
        case protocol.FC.READ_WRITE_MULTIPLE_REGISTERS: {
          if (broadcast) return null;
          const request = protocol.decodeReadWriteMultipleRegistersRequest(pdu);
          device.validateRange('holdingRegisters', request.readAddress, request.readQuantity);
          device.validateRange('holdingRegisters', request.writeAddress, request.writeQuantity);
          device.write('holdingRegisters', request.writeAddress, request.values);
          const values = device.read('holdingRegisters', request.readAddress, request.readQuantity);
          return protocol.encodeReadRegistersResponse({ functionCode, values });
        }
        case protocol.FC.READ_EXCEPTION_STATUS: {
          if (broadcast) return null;
          protocol.decodeReadExceptionStatusRequest(pdu);
          return protocol.encodeReadExceptionStatusResponse({ status: device.exceptionStatus });
        }
        case protocol.FC.DIAGNOSTICS: {
          if (broadcast) return null;
          const request = protocol.decodeDiagnosticsRequest(pdu);
          const data = this._diagnosticValue(request.subFunction, request.data);
          if (data == null) return this._exception(functionCode, 1);
          return protocol.encodeDiagnosticsResponse({ subFunction: request.subFunction, data });
        }
        case protocol.FC.GET_COMM_EVENT_COUNTER: {
          if (broadcast) return null;
          protocol.decodeCommEventCounterRequest(pdu);
          return protocol.encodeCommEventCounterResponse({
            status: 0,
            eventCount: Math.min(0xFFFF, this.stats.requests),
          });
        }
        case protocol.FC.GET_COMM_EVENT_LOG: {
          if (broadcast) return null;
          protocol.decodeCommEventLogRequest(pdu);
          return protocol.encodeCommEventLogResponse({
            status: 0,
            eventCount: Math.min(0xFFFF, this.stats.requests),
            messageCount: Math.min(0xFFFF, this.stats.responses),
            events: [],
          });
        }
        case protocol.FC.REPORT_SERVER_ID: {
          if (broadcast) return null;
          protocol.decodeReportServerIdRequest(pdu);
          const productCode = device.identity.get(1) || Buffer.from(`Virtual-${device.unitId}`);
          return protocol.encodeReportServerIdResponse({
            serverId: device.unitId & 0xFF,
            runIndicatorStatus: 0xFF,
            additionalData: productCode.subarray(0, 249),
          });
        }
        case protocol.FC.READ_FILE_RECORD: {
          if (broadcast) return null;
          const request = protocol.decodeReadFileRecordRequest(pdu);
          const records = request.records.map((record) => ({
            referenceType: record.referenceType,
            values: device.readFileRecord(record.fileNumber, record.recordNumber, record.recordLength),
          }));
          return protocol.encodeReadFileRecordResponse({ records });
        }
        case protocol.FC.WRITE_FILE_RECORD: {
          if (broadcast) return null;
          const request = protocol.decodeWriteFileRecordRequest(pdu);
          for (const record of request.records) device.writeFileRecord(record.fileNumber, record.recordNumber, record.values);
          return protocol.encodeWriteFileRecordResponse({ records: request.records });
        }
        case protocol.FC.READ_FIFO_QUEUE: {
          if (broadcast) return null;
          const request = protocol.decodeReadFifoQueueRequest(pdu);
          return protocol.encodeReadFifoQueueResponse({ values: device.readFifo(request.address) });
        }
        case protocol.FC.ENCAPSULATED_INTERFACE:
          if (broadcast) return null;
          return this._deviceIdentification(device, pdu);
        default:
          return this._exception(functionCode, 1);
      }
    } catch (error) {
      if (broadcast) return null;
      if (error instanceof VirtualDeviceError) return this._exception(functionCode, error.exceptionCode || 4);
      if (error instanceof protocol.ProtocolValidationError) return this._exception(functionCode, 3);
      this._emitRuntimeError(error, 'process-pdu');
      return this._exception(functionCode, 4);
    }
  }

  _diagnosticValue(subFunction, requestData) {
    switch (subFunction) {
      case 0x0000: return requestData; // Return Query Data
      case 0x000A: { // Clear counters and diagnostic register
        this.stats.requests = 0;
        this.stats.responses = 0;
        this.stats.broadcasts = 0;
        this.stats.silentUnknownUnits = 0;
        this.stats.exceptions = 0;
        this.stats.malformed = 0;
        this.stats.runtimeErrors = 0;
        return 0;
      }
      case 0x000B: return Math.min(0xFFFF, this.stats.requests);
      case 0x000C: return Math.min(0xFFFF, this.stats.malformed);
      case 0x000D: return Math.min(0xFFFF, this.stats.exceptions);
      case 0x000E: return Math.min(0xFFFF, this.stats.requests);
      case 0x000F: return Math.min(0xFFFF, this.stats.silentUnknownUnits);
      case 0x0010: return 0;
      case 0x0011: return 0;
      case 0x0012: return 0;
      default: return null;
    }
  }

  _deviceIdentification(device, pdu) {
    const request = protocol.decodeDeviceIdRequest(pdu);
    const available = device.getIdentityObjects(request);
    if (request.readDeviceIdCode === 4 && available.length === 0) return this._exception(pdu[0], 2);

    const selected = [];
    let used = 7;
    let nextObjectId = 0;
    for (const object of available) {
      const bytes = Buffer.isBuffer(object.value) ? object.value : Buffer.from(String(object.value));
      const needed = 2 + bytes.length;
      if (used + needed > protocol.MAX_PDU_LENGTH) {
        nextObjectId = object.id;
        break;
      }
      selected.push({ id: object.id, value: bytes });
      used += needed;
    }
    const moreFollows = selected.length < available.length;
    if (moreFollows && nextObjectId === 0) nextObjectId = available[selected.length]?.id ?? 0;
    return protocol.encodeDeviceIdResponse({
      readDeviceIdCode: request.readDeviceIdCode,
      conformityLevel: 2,
      moreFollows,
      nextObjectId,
      objects: selected,
    });
  }

  _exception(functionCode, exceptionCode) {
    return Buffer.from([(functionCode & 0x7F) | 0x80, exceptionCode]);
  }

  _emitRuntimeError(error, phase) {
    this.stats.runtimeErrors++;
    const diagnostic = Object.freeze({ phase, code: error?.code || null, message: String(error?.message || error) });
    this.emit('server-error', diagnostic);
    this.emit('event', createWorkbenchEvent({
      type: 'slave.runtime-error',
      source: 'virtual-slave',
      connectionId: this.connectionId,
      ownerMode: 'slave',
      details: diagnostic,
    }));
  }

  _emitTraffic(type, unitId, raw, details) {
    const event = createWorkbenchEvent({
      type,
      source: 'virtual-slave',
      connectionId: this.connectionId,
      ownerMode: 'slave',
      direction: type === 'traffic.tx' ? 'tx' : type === 'traffic.rx' ? 'rx' : null,
      unitId,
      functionCode: details?.functionCode ?? null,
      raw,
      details,
    });
    this.emit('event', event);
  }
}

module.exports = {
  WRITE_FUNCTIONS,
  SERIAL_BROADCAST_WRITE_FUNCTIONS,
  VirtualSlaveServer,
};
