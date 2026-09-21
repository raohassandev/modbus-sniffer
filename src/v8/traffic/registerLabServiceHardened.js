'use strict';

const base = require('./registerLabService');

const PENDING_RETENTION_MS = 120000;

class RegisterLabService extends base.RegisterLabService {
  _setPending(key, value) {
    this.pending.set(key, value);

    if (this.pending.size > this.maxPending) {
      const oldest = [...this.pending.entries()]
        .sort((a, b) => Number(a[1]?.timestamp || 0) - Number(b[1]?.timestamp || 0))
        .slice(0, this.pending.size - this.maxPending);
      for (const [pendingKey] of oldest) this.pending.delete(pendingKey);
    }

    // Register Lab is also fed replay/offline evidence whose timestamps may be
    // far in the past. Expire pending requests relative to the event stream,
    // not the workstation wall clock, otherwise historical request/response
    // pairs are discarded before the matching response is ingested.
    const eventTimestamp = Number(value?.timestamp);
    const referenceTimestamp = Number.isFinite(eventTimestamp) ? eventTimestamp : Date.now();
    const cutoff = referenceTimestamp - PENDING_RETENTION_MS;
    for (const [pendingKey, pending] of this.pending) {
      const pendingTimestamp = Number(pending?.timestamp);
      if (Number.isFinite(pendingTimestamp) && pendingTimestamp < cutoff) this.pending.delete(pendingKey);
    }
  }
}

module.exports = {
  ...base,
  PENDING_RETENTION_MS,
  RegisterLabService,
};
