'use strict';

const { createWorkbenchEvent } = require('../events');
const { MasterEngine, WRITE_FUNCTIONS, MasterRequestError } = require('../master/masterEngine');

class DiscoveryRequestEngine extends MasterEngine {
  constructor(options = {}) {
    super({ ...options, ownerId: options.ownerId || 'v8-discovery' });
    this.ownerMode = 'discovery';
  }

  async open() {
    const status = this.broker.getConnection(this.connectionId);
    if (status.owner && (status.owner.ownerMode !== this.ownerMode || status.owner.ownerId !== this.ownerId)) {
      throw new MasterRequestError('OWNER_MISMATCH', 'Connection is owned by a different runtime', { connectionId: this.connectionId });
    }
    if (status.state === 'open' && (status.transportState === 'open' || status.transportState === 'unknown')) return status;
    return this.broker.open(this.connectionId, { ownerMode: this.ownerMode, ownerId: this.ownerId });
  }

  request(options = {}) {
    const pdu = options?.pdu;
    const functionCode = Buffer.isBuffer(pdu) || Array.isArray(pdu) || ArrayBuffer.isView(pdu) ? Number(Buffer.from(pdu)[0]) : null;
    if (WRITE_FUNCTIONS.has(functionCode)) {
      return Promise.reject(new MasterRequestError('DISCOVERY_READ_ONLY', 'Discovery cannot execute Modbus write functions', { functionCode }));
    }
    return super.request(options);
  }

  setWriteEnabled() {
    throw new MasterRequestError('DISCOVERY_READ_ONLY', 'Discovery cannot enable writes');
  }

  _emit(type, unitId, functionCode, raw, details) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'discovery-request-engine',
      connectionId: this.connectionId,
      ownerMode: this.ownerMode,
      direction: type === 'traffic.tx' ? 'tx' : type === 'traffic.rx' ? 'rx' : null,
      unitId,
      functionCode,
      raw,
      details,
    }));
  }
}

module.exports = {
  DiscoveryRequestEngine,
};
