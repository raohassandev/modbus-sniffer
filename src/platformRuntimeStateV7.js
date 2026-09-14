'use strict';

const { PlatformRuntimeStateV62 } = require('./platformRuntimeStateV62');
const {
  analyzeRegisterIntelligence,
  reconstructPollingCycle,
  buildDeviceFingerprints,
  analyzeRelationships,
  detectAnomalies,
  compareCaptures,
  buildIntelligenceSummary
} = require('./intelligenceV7');

class PlatformRuntimeStateV7 extends PlatformRuntimeStateV62 {
  constructor(options={}) {
    super(options);
    this.intelligenceVersion = '7.0.0';
    this.intelligenceCacheMs = 4000;
    this._intelligenceCache = null;
  }

  clearCapture() {
    const out = super.clearCapture();
    this._intelligenceCache = null;
    return out;
  }

  getRegisterIntelligence(filters={}) { return analyzeRegisterIntelligence(this, filters); }
  getPollingCycle(filters={}) { return reconstructPollingCycle(this, filters); }
  getDeviceFingerprints(filters={}) { return buildDeviceFingerprints(this, filters); }
  getRelationships(filters={}) { return analyzeRelationships(this, filters); }
  getAnomalies(filters={}) { return detectAnomalies(this, filters); }
  compareCaptures(before, after, options={}) { return compareCaptures(before, after, options); }

  getIntelligenceSummary(filters={}) {
    const unrestricted = !filters || Object.keys(filters).length === 0;
    const now = Date.now();
    if (unrestricted && this._intelligenceCache && now - this._intelligenceCache.at < this.intelligenceCacheMs) return this._intelligenceCache.value;
    const value = buildIntelligenceSummary(this, filters || {});
    if (unrestricted) this._intelligenceCache = { at:now, value };
    return value;
  }

  getStatus() {
    const status = super.getStatus();
    status.analyzerVersion = this.intelligenceVersion;
    return status;
  }

  getAnalysis() {
    const analysis = super.getAnalysis();
    analysis.intelligence = this.getIntelligenceSummary();
    return analysis;
  }

  getDevice(ref, options={}) {
    const device = super.getDevice(ref, options);
    if (!device) return null;
    const key = device.summary?.deviceKey;
    if (!key) return device;
    device.intelligence = {
      registers: this.getRegisterIntelligence({ deviceKey:key, limit:300 }),
      fingerprints: this.getDeviceFingerprints({ deviceKey:key }),
      relationships: this.getRelationships({ deviceKey:key, limit:120 }),
      anomalies: this.getAnomalies({ deviceKey:key, limit:120 })
    };
    return device;
  }

  getDataTypeAnalysis(filters={}) {
    const base = super.getDataTypeAnalysis(filters);
    if (base?.error || !base?.deviceKey || !Number.isInteger(Number(base.startAddress))) return base;
    const intelligence = this.getRegisterIntelligence({ deviceKey:base.deviceKey, fc:base.functionCode, limit:500 });
    base.intelligence = intelligence.rows.find(r=>Number(r.address)===Number(base.startAddress)) || null;
    return base;
  }

  exportCapture() {
    const capture = super.exportCapture();
    capture.analyzerVersion = this.intelligenceVersion;
    capture.intelligenceVersion = this.intelligenceVersion;
    return capture;
  }
}

module.exports = { PlatformRuntimeStateV7 };
