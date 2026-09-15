'use strict';

const base = require('./connectionBroker');
const { createWorkbenchEvent } = require('./events');

function sanitizeAuditRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null;
  const safe = {};
  for (const [key, value] of Object.entries(route)) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
  }
  return Object.keys(safe).length ? Object.freeze(safe) : null;
}

function isUnknownTransmissionOutcome(error) {
  return error?.code === 'TRANSMISSION_OUTCOME_UNKNOWN' || error?.details?.mayHaveTransmitted === true;
}

class ConnectionBroker extends base.ConnectionBroker {
  async transmit(connectionId, { ownerId, bytes, intent, route = null }) {
    const payload = Buffer.from(bytes ?? []);
    try {
      return await super.transmit(connectionId, { ownerId, bytes: payload, intent, route });
    } catch (error) {
      if (!isUnknownTransmissionOutcome(error)) throw error;

      const entry = this._get(connectionId);
      entry.lastError = String(error?.message || error);
      let auditRecord = null;
      if (intent === 'write' || intent === 'raw' || entry.owner?.ownerMode === 'test') {
        auditRecord = this._appendTransmissionAudit(entry, {
          payload,
          intent,
          route,
          outcome: 'unknown',
          error,
        });
      }

      if (intent === 'write') {
        entry.writeLock = 'LOCKED';
        this._emitState('connection.write-lock', entry, {
          reason: 'transmission-outcome-unknown',
          errorCode: error?.code || null,
        });
      }

      if (error && typeof error === 'object') {
        error.details = {
          ...(error.details || {}),
          mayHaveTransmitted: true,
          transmissionOutcome: 'unknown',
          requestRaw: Buffer.from(payload),
          transmissionAuditId: auditRecord?.auditId || null,
        };
      }
      throw error;
    }
  }

  _appendTransmissionAudit(entry, {
    payload,
    intent,
    route,
    outcome = 'confirmed',
    error = null,
  }) {
    const record = Object.freeze({
      auditId: `tx-${++this.transmissionAuditSequence}`,
      timestamp: Date.now(),
      connectionId: entry.connectionId,
      resourceKey: entry.resourceKey,
      transportKind: entry.transportKind,
      ownerMode: entry.owner?.ownerMode || null,
      ownerId: entry.owner?.ownerId || null,
      intent,
      outcome,
      byteLength: payload.length,
      rawHex: payload.toString('hex').toUpperCase(),
      route: sanitizeAuditRoute(route),
      errorCode: error?.code || null,
      error: error ? String(error?.message || error) : null,
    });

    this.transmissionAudit.push(record);
    if (this.transmissionAudit.length > this.maxTransmissionAuditEntries) {
      this.transmissionAudit.splice(0, this.transmissionAudit.length - this.maxTransmissionAuditEntries);
    }
    this.emit('transmission-audit', record);
    this.emit('event', createWorkbenchEvent({
      type: 'connection.transmit-audit',
      source: 'connection-broker',
      connectionId: entry.connectionId,
      ownerMode: entry.owner?.ownerMode ?? null,
      direction: 'tx',
      raw: payload,
      details: {
        auditId: record.auditId,
        intent,
        outcome,
        ownerId: record.ownerId,
        transportKind: entry.transportKind,
        errorCode: record.errorCode,
      },
    }));
    return record;
  }
}

module.exports = {
  ...base,
  BaseConnectionBroker: base.ConnectionBroker,
  ConnectionBroker,
  isUnknownTransmissionOutcome,
};
