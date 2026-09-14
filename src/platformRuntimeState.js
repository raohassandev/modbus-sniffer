'use strict';

const { AdvancedRuntimeState, percentile, avg, median, stddev, requestDescriptor } = require('./advancedRuntimeState');
const { analyzeWords } = require('./dataTypeAnalyzer');
const { fallbackChannel, makeDeviceKey, parseDeviceKey, normalizeIdentity } = require('./transportIdentity');

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return value;
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
}

function overlap(startA, qtyA, startB, endB) {
  if (!Number.isInteger(startA) || !Number.isInteger(qtyA) || !Number.isInteger(startB) || !Number.isInteger(endB)) return false;
  const endA = startA + Math.max(0, qtyA - 1);
  return startA <= endB && endA >= startB;
}

function identityFields(identity) {
  return {
    transport: identity.transport,
    channelId: identity.channelId,
    deviceKey: identity.deviceKey,
    unitId: identity.unitId,
    slaveId: identity.unitId
  };
}

class PlatformRuntimeState extends AdvancedRuntimeState {
  clearCapture() {
    this.channels = new Map();
    return super.clearCapture();
  }

  registerChannel(channel = {}) {
    if (!channel.channelId) throw new Error('channelId is required.');
    const stamp = Date.now();
    const prev = this.channels.get(channel.channelId) || {};
    const merged = {
      ...prev,
      ...channel,
      channelId: String(channel.channelId),
      transport: String(channel.transport || prev.transport || 'RTU').toUpperCase() === 'TCP' ? 'TCP' : 'RTU',
      mode: String(channel.mode || prev.mode || 'offline'),
      name: String(channel.name || prev.name || channel.channelId),
      active: channel.active !== false,
      createdAt: prev.createdAt || channel.createdAt || stamp,
      updatedAt: stamp
    };
    this.channels.set(merged.channelId, merged);
    return { ...merged };
  }

  _identityFrom(value = {}) {
    const decoded = value.decoded || value;
    const transport = value.transport || decoded.transport || 'RTU';
    let channel = value.channel || decoded.channel || null;
    const channelId = value.channelId || decoded.channelId || channel?.channelId || null;
    if (!channel && channelId) {
      channel = this.channels.get(channelId) || { ...fallbackChannel(transport), channelId };
    }
    const identity = normalizeIdentity({
      transport,
      channel,
      channelId,
      deviceKey: value.deviceKey || decoded.deviceKey,
      unitId: value.unitId ?? decoded.unitId,
      slaveId: value.slaveId ?? decoded.slaveId
    });
    identity.channel = this.registerChannel(identity.channel);
    return identity;
  }

  _stampDecoded(decoded, identity) {
    if (!decoded) return decoded;
    return { ...decoded, ...identityFields(identity), channel: identity.channel };
  }

  _prepareTransaction(tx = {}) {
    const identity = this._identityFrom(tx);
    const prepared = {
      ...tx,
      ...identityFields(identity),
      channel: identity.channel,
      decoded: this._stampDecoded(tx.decoded || {}, identity)
    };
    if (tx.request) prepared.request = this._stampDecoded(tx.request, identity);
    return prepared;
  }

  _buildTransaction(tx, timestamp, raw, meters) {
    const prepared = this._prepareTransaction(tx);
    const e = super._buildTransaction(prepared, timestamp, raw, meters);
    Object.assign(e, identityFields(prepared), {
      channel: prepared.channel,
      sessionId: prepared.sessionId || null,
      endpoint: prepared.channel?.endpoint || prepared.endpoint || null
    });
    e.decoded = this._stampDecoded(e.decoded, prepared);
    if (e.request) e.request = this._stampDecoded(e.request, prepared);
    return e;
  }

  _descriptor(decoded = {}) {
    const identity = this._identityFrom(decoded);
    const base = requestDescriptor({ ...decoded, slaveId: identity.unitId });
    base.channelId = identity.channelId;
    base.deviceKey = identity.deviceKey;
    base.unitId = identity.unitId;
    base.slaveId = identity.unitId;
    base.transport = identity.transport;
    base.key = [identity.deviceKey, base.functionCode, base.operation, base.startAddress ?? '-', base.quantity ?? '-', base.writeStartAddress ?? '-', base.writeQuantity ?? '-'].join(':');
    return base;
  }

  recordTimeout(request, expiredAt = Date.now(), timeoutMs = 1000, transport = null) {
    if (!request) return null;
    const prepared = { ...request, transport: transport || request.transport || 'RTU' };
    let identity;
    try { identity = this._identityFrom(prepared); } catch { return null; }
    this.timeouts++;
    const event = {
      id: ++this.sequence,
      timestamp: expiredAt,
      direction: 'TIMEOUT',
      timeout: true,
      timeoutMs,
      ...identityFields(identity),
      channel: identity.channel,
      sessionId: request.sessionId || null,
      endpoint: identity.channel?.endpoint || request.endpoint || null,
      functionCode: request.functionCode,
      functionName: request.functionName,
      exception: false,
      exceptionCode: null,
      exceptionName: null,
      rttMs: null,
      matched: false,
      rawHex: '',
      byteLength: 0,
      decoded: this._stampDecoded(request, identity),
      request: this._stampDecoded(request, identity),
      meters: []
    };
    this.transactions.push(event);
    this._trimTransactions();
    const s = this._ensureDevice(identity, expiredAt);
    s.timeouts++;
    s.lastTimeoutAt = expiredAt;
    const f = this._ensureFunction(event.functionCode, event.functionName, expiredAt);
    f.timeouts++;
    f.lastSeen = expiredAt;
    const descriptor = this._descriptor(event.request);
    const pattern = this.pollPatterns.get(descriptor.key);
    if (pattern) {
      pattern.timeouts++;
      pattern.lastTimeoutAt = expiredAt;
      pattern.lastResult = 'timeout';
    }
    const b = this._bucket(expiredAt); b.timeouts++;
    this.emit('transaction', event);
    this.emit('timeout', event);
    return event;
  }

  _ensureDevice(identityLike, timestamp) {
    const identity = identityLike.deviceKey ? this._identityFrom(identityLike) : this._identityFrom(identityLike || {});
    let s = this.slaves.get(identity.deviceKey);
    if (!s) {
      s = {
        deviceKey: identity.deviceKey, channelId: identity.channelId, transport: identity.transport,
        unitId: identity.unitId, slaveId: identity.unitId,
        frames:0, requests:0, responses:0, exceptions:0, unmatchedResponses:0, timeouts:0, bytes:0,
        rtts:[], firstSeen:timestamp, lastSeen:timestamp, lastRequestAt:null, lastResponseAt:null, lastTimeoutAt:null,
        functions:new Set()
      };
      this.slaves.set(identity.deviceKey, s);
    }
    return s;
  }

  _recordSlave(event) {
    if (event.direction === 'TIMEOUT') return;
    const identity = this._identityFrom(event);
    const s = this._ensureDevice(identity, event.timestamp);
    s.frames++;
    s.bytes += Number(event.byteLength || 0);
    if (event.direction === 'REQ') { s.requests++; s.lastRequestAt = event.timestamp; }
    if (event.direction === 'RSP') { s.responses++; s.lastResponseAt = event.timestamp; }
    if (event.exception) s.exceptions++;
    if (event.direction === 'RSP' && !event.matched) s.unmatchedResponses++;
    if (Number.isFinite(Number(event.rttMs))) {
      s.rtts.push(Number(event.rttMs));
      if (s.rtts.length > 1000) s.rtts.splice(0, s.rtts.length - 1000);
    }
    if (event.functionCode != null) s.functions.add(event.functionCode);
    s.lastSeen = event.timestamp;
  }

  _recordPollRequest(event) {
    const descriptor = this._descriptor(event.decoded || event);
    if (!descriptor.deviceKey || !Number.isFinite(descriptor.functionCode)) return;
    const p = this._ensurePollPattern(descriptor, event.timestamp);
    if (p.lastRequestAt != null) {
      const dt = event.timestamp - p.lastRequestAt;
      if (dt > 0 && dt < 24 * 60 * 60 * 1000) {
        p.intervals.push(dt);
        if (p.intervals.length > 500) p.intervals.splice(0, p.intervals.length - 500);
      }
    }
    p.requests++;
    p.lastRequestAt = event.timestamp;
    p.lastRequestId = event.id;
    p.lastResult = 'pending';
  }

  _recordPollResponse(event) {
    if (!event.request) return;
    const descriptor = this._descriptor(event.request);
    const p = this._ensurePollPattern(descriptor, event.request.timestamp || event.timestamp);
    p.responses++;
    p.lastResponseAt = event.timestamp;
    p.lastResult = event.exception ? 'exception' : 'ok';
    if (event.exception) p.exceptions++;
    if (Number.isFinite(Number(event.rttMs))) {
      p.rtts.push(Number(event.rttMs));
      if (p.rtts.length > 500) p.rtts.splice(0, p.rtts.length - 500);
    }
    const regs = event.decoded?.registers;
    if (Array.isArray(regs)) p.lastValues = regs.slice(0, 64).map(x => ({ address:x.address, value:x.value, hex:x.hex || `0x${Number(x.value).toString(16).toUpperCase().padStart(4,'0')}` }));
  }

  _touchRegister(identityLike, functionCode, address, value, timestamp, kind) {
    if (!Number.isInteger(address) || functionCode == null) return;
    const identity = this._identityFrom(identityLike);
    const key = `${identity.deviceKey}:${functionCode}:${address}`;
    let reg = this.registers.get(key);
    if (!reg) {
      reg = {
        deviceKey:identity.deviceKey, channelId:identity.channelId, transport:identity.transport,
        unitId:identity.unitId, slaveId:identity.unitId, functionCode, address,
        reads:0, writes:0, changes:0, lastValue:null, lastHex:null, min:null, max:null,
        firstSeen:timestamp, lastSeen:timestamp, history:[]
      };
      this.registers.set(key, reg);
    }
    if (kind === 'read') reg.reads++;
    if (kind === 'write') reg.writes++;
    if (value != null) {
      const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
      if (reg.lastValue != null && reg.lastValue !== numeric) reg.changes++;
      reg.lastValue = numeric;
      reg.lastHex = Number.isFinite(numeric) ? `0x${(numeric & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')}` : null;
      if (Number.isFinite(numeric)) {
        reg.min = reg.min == null ? numeric : Math.min(reg.min, numeric);
        reg.max = reg.max == null ? numeric : Math.max(reg.max, numeric);
        reg.history.push({ timestamp, value:numeric });
        if (reg.history.length > 64) reg.history.splice(0, reg.history.length - 64);
      }
    }
    reg.lastSeen = timestamp;
  }

  _recordRegisters(tx, timestamp) {
    const d = tx.decoded || {};
    const identity = this._identityFrom(tx);
    if (tx.direction === 'RSP' && Array.isArray(d.registers)) for (const reg of d.registers) this._touchRegister(identity, d.functionCode, reg.address, reg.value, timestamp, 'read');
    if (tx.direction === 'RSP' && Array.isArray(d.points)) for (const point of d.points) this._touchRegister(identity, d.functionCode, point.address, point.value ? 1 : 0, timestamp, 'read');
    if (tx.direction !== 'REQ') return;
    if ([5,6].includes(d.functionCode) && Number.isInteger(d.address)) this._touchRegister(identity, d.functionCode, d.address, d.value, timestamp, 'write');
    if ([15,16].includes(d.functionCode) && Number.isInteger(d.startAddress) && Array.isArray(d.words)) d.words.forEach((value,i)=>this._touchRegister(identity,d.functionCode,d.startAddress+i,value,timestamp,'write'));
    if (d.functionCode === 23 && Number.isInteger(d.writeStartAddress) && Array.isArray(d.words)) d.words.forEach((value,i)=>this._touchRegister(identity,d.functionCode,d.writeStartAddress+i,value,timestamp,'write'));
  }

  _pollView(p) {
    const intervals = p.intervals || [], rtts = p.rtts || [], med = median(intervals), sd = stddev(intervals);
    return {
      key:p.key, deviceKey:p.deviceKey, channelId:p.channelId, transport:p.transport,
      unitId:p.unitId, slaveId:p.unitId,
      functionCode:p.functionCode, operation:p.operation, startAddress:p.startAddress, quantity:p.quantity,
      endAddress:Number.isInteger(p.startAddress)&&Number.isInteger(p.quantity)?p.startAddress+p.quantity-1:null,
      writeStartAddress:p.writeStartAddress, writeQuantity:p.writeQuantity,
      requests:p.requests, responses:p.responses, timeouts:p.timeouts, exceptions:p.exceptions,
      responseRate:p.requests?round((p.responses/p.requests)*100,2):0,
      timeoutRate:p.requests?round((p.timeouts/p.requests)*100,2):0,
      avgIntervalMs:round(avg(intervals)), medianIntervalMs:round(med), p95IntervalMs:round(percentile(intervals,95)),
      minIntervalMs:intervals.length?Math.min(...intervals):null, maxIntervalMs:intervals.length?Math.max(...intervals):null,
      jitterMs:round(sd), jitterPct:med?round((sd/med)*100,2):null,
      avgRttMs:round(avg(rtts)), p95RttMs:round(percentile(rtts,95)),
      firstSeen:p.firstSeen, lastRequestAt:p.lastRequestAt, lastResponseAt:p.lastResponseAt,
      lastTimeoutAt:p.lastTimeoutAt, lastResult:p.lastResult, lastValues:p.lastValues||[]
    };
  }

  _keysForUnit(unitId) {
    const n = Number(unitId);
    return [...this.slaves.values()].filter(s => s.unitId === n).map(s => s.deviceKey);
  }

  resolveDeviceKey(ref, channelId = null, { requireObserved = true } = {}) {
    if (ref == null || ref === '') return null;
    const parsed = typeof ref === 'string' ? parseDeviceKey(ref) : null;
    if (parsed) {
      if (requireObserved && !this.slaves.has(parsed.deviceKey)) return null;
      return parsed.deviceKey;
    }
    const unitId = Number(ref);
    if (!Number.isInteger(unitId) || unitId < 0 || unitId > 255) return null;
    if (channelId) {
      const key = makeDeviceKey(channelId, unitId);
      return !requireObserved || this.slaves.has(key) ? key : null;
    }
    const keys = this._keysForUnit(unitId);
    if (keys.length > 1) {
      const err = new Error(`Unit/Slave ${unitId} exists on multiple channels. Specify channelId or deviceKey.`);
      err.code = 'AMBIGUOUS_DEVICE'; err.unitId = unitId; err.deviceKeys = keys;
      throw err;
    }
    return keys[0] || null;
  }

  _filter(filters = {}) {
    const channelId = filters.channelId ? String(filters.channelId) : null;
    const explicit = filters.deviceKey ? this.resolveDeviceKey(String(filters.deviceKey), null, {requireObserved:false}) : null;
    const unitRaw = filters.unitId ?? filters.slave;
    let deviceKey = explicit;
    if (!deviceKey && unitRaw !== undefined && unitRaw !== null && unitRaw !== '') deviceKey = this.resolveDeviceKey(unitRaw, channelId, {requireObserved:false});
    return {
      channelId,
      deviceKey,
      unitId: unitRaw === undefined || unitRaw === null || unitRaw === '' ? null : Number(unitRaw),
      fc: filters.fc === undefined || filters.fc === null || filters.fc === '' ? null : Number(filters.fc)
    };
  }

  getPollGroups(filters = {}) {
    const f = this._filter(filters);
    return [...this.pollPatterns.values()].map(p=>this._pollView(p))
      .filter(p=>!f.channelId||p.channelId===f.channelId)
      .filter(p=>!f.deviceKey||p.deviceKey===f.deviceKey)
      .filter(p=>!Number.isFinite(f.fc)||p.functionCode===f.fc)
      .sort((a,b)=>String(a.channelId).localeCompare(String(b.channelId))||a.unitId-b.unitId||a.functionCode-b.functionCode||(a.startAddress??0)-(b.startAddress??0));
  }

  _buildRanges(filters = {}) {
    if (filters == null || typeof filters !== 'object') filters = { slave:filters };
    const f = this._filter(filters), groups = new Map();
    for (const r of this.registers.values()) {
      if (f.channelId && r.channelId !== f.channelId) continue;
      if (f.deviceKey && r.deviceKey !== f.deviceKey) continue;
      const key = `${r.deviceKey}|${r.functionCode}`;
      if (!groups.has(key)) groups.set(key,{sample:r,addresses:[]});
      groups.get(key).addresses.push(r.address);
    }
    const result=[];
    for (const {sample,addresses} of groups.values()) {
      addresses.sort((a,b)=>a-b); let start=null,prev=null;
      for (const address of addresses) {
        if (start==null) { start=prev=address; continue; }
        if (address<=prev+1) { prev=Math.max(prev,address); continue; }
        result.push({deviceKey:sample.deviceKey,channelId:sample.channelId,transport:sample.transport,unitId:sample.unitId,slaveId:sample.unitId,functionCode:sample.functionCode,startAddress:start,endAddress:prev,count:prev-start+1});
        start=prev=address;
      }
      if (start!=null) result.push({deviceKey:sample.deviceKey,channelId:sample.channelId,transport:sample.transport,unitId:sample.unitId,slaveId:sample.unitId,functionCode:sample.functionCode,startAddress:start,endAddress:prev,count:prev-start+1});
    }
    return result.sort((a,b)=>String(a.channelId).localeCompare(String(b.channelId))||a.unitId-b.unitId||a.functionCode-b.functionCode||a.startAddress-b.startAddress);
  }

  getRegisters(filters = {}) {
    const f = this._filter(filters), q=filters.q?String(filters.q).toLowerCase():null;
    const limit=Math.min(20000,Math.max(1,Number(filters.limit)||5000));
    const polls=this.getPollGroups(filters);
    return [...this.registers.values()]
      .filter(r=>!f.channelId||r.channelId===f.channelId)
      .filter(r=>!f.deviceKey||r.deviceKey===f.deviceKey)
      .filter(r=>!Number.isFinite(f.fc)||r.functionCode===f.fc)
      .filter(r=>!q||`${r.deviceKey} ${r.address} ${r.lastValue} ${r.lastHex||''}`.toLowerCase().includes(q))
      .map(r=>{const related=polls.filter(p=>p.deviceKey===r.deviceKey&&p.functionCode===r.functionCode&&overlap(p.startAddress,p.quantity,r.address,r.address));const intervals=related.map(p=>p.medianIntervalMs).filter(Number.isFinite);return{...r,history:undefined,samples:r.history.length,pollIntervalMs:intervals.length?round(median(intervals)):null};})
      .sort((a,b)=>String(a.channelId).localeCompare(String(b.channelId))||a.unitId-b.unitId||a.functionCode-b.functionCode||a.address-b.address)
      .slice(0,limit);
  }

  _deviceSummary(device) {
    const polls=this.getPollGroups({deviceKey:device.deviceKey});
    const regs=[...this.registers.values()].filter(r=>r.deviceKey===device.deviceKey);
    const intervals=polls.map(p=>p.medianIntervalMs).filter(Number.isFinite),expected=intervals.length?median(intervals):null;
    const now=Date.now(),silenceLimit=Math.max(3000,Number(expected||0)*3),status=now-device.lastSeen<=silenceLimit?'online':now-device.lastSeen<=silenceLimit*3?'silent':'offline';
    const timeoutRate=device.requests?device.timeouts/device.requests:0,exceptionRate=device.responses?device.exceptions/device.responses:0,unmatchedRate=device.responses?device.unmatchedResponses/device.responses:0,p95=percentile(device.rtts,95);
    let health=100;health-=Math.min(45,timeoutRate*180);health-=Math.min(25,exceptionRate*160);health-=Math.min(15,unmatchedRate*100);if(p95!=null&&p95>500)health-=Math.min(15,(p95-500)/100);if(status==='silent')health-=10;if(status==='offline')health-=30;
    const reads=regs.reduce((s,r)=>s+r.reads,0),writes=regs.reduce((s,r)=>s+r.writes,0),channel=this.channels.get(device.channelId)||null;
    return {
      deviceKey:device.deviceKey,channelId:device.channelId,channelName:channel?.name||device.channelId,transport:device.transport,
      unitId:device.unitId,slaveId:device.unitId,name:`${device.transport==='TCP'?'Unit':'Slave'} ${device.unitId}`,
      status,healthScore:Math.max(0,Math.round(health)),frames:device.frames,requests:device.requests,responses:device.responses,timeouts:device.timeouts,
      timeoutRate:round(timeoutRate*100,2),exceptions:device.exceptions,exceptionRate:round(exceptionRate*100,2),unmatchedResponses:device.unmatchedResponses,
      registerCount:regs.length,readCount:reads,writeCount:writes,pollGroupCount:polls.length,expectedPollIntervalMs:round(expected),avgRttMs:round(avg(device.rtts)),p95RttMs:round(p95),
      functions:[...device.functions].sort((a,b)=>a-b),firstSeen:device.firstSeen,lastSeen:device.lastSeen,lastRequestAt:device.lastRequestAt,lastResponseAt:device.lastResponseAt,lastTimeoutAt:device.lastTimeoutAt
    };
  }

  getDevices(filters = {}) {
    const channelId=filters.channelId?String(filters.channelId):null;
    return [...this.slaves.values()].filter(s=>!channelId||s.channelId===channelId).map(s=>this._deviceSummary(s)).sort((a,b)=>String(a.channelId).localeCompare(String(b.channelId))||a.unitId-b.unitId);
  }

  getDevice(ref, options = {}) {
    const key=this.resolveDeviceKey(ref,options.channelId||null);
    if(!key)return null;const device=this.slaves.get(key);if(!device)return null;
    const summary=this._deviceSummary(device),polls=this.getPollGroups({deviceKey:key}),registers=this.getRegisters({deviceKey:key,limit:20000});
    const ranges=this._buildRanges({deviceKey:key}).map(range=>{const related=polls.filter(p=>p.functionCode===range.functionCode&&overlap(p.startAddress,p.quantity,range.startAddress,range.endAddress));const intervals=related.map(p=>p.medianIntervalMs).filter(Number.isFinite);const values=registers.filter(r=>r.functionCode===range.functionCode&&r.address>=range.startAddress&&r.address<=range.endAddress).slice(0,24).map(r=>({address:r.address,value:r.lastValue,hex:r.lastHex}));return{...range,pollIntervalMs:intervals.length?round(median(intervals)):null,pollGroups:related.length,values};});
    const recentTransactions=this.getTransactions({deviceKey:key,limit:100}),issues=[];
    if(summary.timeouts)issues.push({severity:summary.timeoutRate>5?'bad':'warn',title:'Missing responses',detail:`${summary.timeouts} request timeout(s), ${summary.timeoutRate}% of requests.`});
    if(summary.exceptions)issues.push({severity:summary.exceptionRate>2?'bad':'warn',title:'Modbus exceptions',detail:`${summary.exceptions} exception response(s), ${summary.exceptionRate}% of responses.`});
    if(summary.p95RttMs!=null&&summary.p95RttMs>500)issues.push({severity:'warn',title:'Slow response tail',detail:`P95 RTT ${summary.p95RttMs} ms.`});
    for(const p of polls)if(p.jitterPct!=null&&p.jitterPct>30&&p.requests>=5)issues.push({severity:'warn',title:'Polling jitter',detail:`FC${p.functionCode} ${p.startAddress??'-'} interval jitter ${p.jitterPct}%.`});
    return{summary,polls,registerGroups:ranges,registers,recentTransactions,issues};
  }

  getTransactions(filters = {}) {
    const limit=Math.min(20000,Math.max(1,Number(filters.limit)||1000)),f=this._filter(filters),direction=filters.direction?String(filters.direction).toUpperCase():null,q=filters.q?String(filters.q).toLowerCase():null,out=[];
    for(let i=this.transactions.length-1;i>=0&&out.length<limit;i--){const t=this.transactions[i];if(f.channelId&&t.channelId!==f.channelId)continue;if(f.deviceKey&&t.deviceKey!==f.deviceKey)continue;if(Number.isFinite(f.fc)&&t.functionCode!==f.fc)continue;if(direction&&t.direction!==direction)continue;if(q&&!`${t.rawHex||''} ${t.functionName||''} ${t.exceptionName||''} ${t.deviceKey||''} ${t.unitId??t.slaveId} ${t.functionCode} ${t.direction} ${JSON.stringify(t.decoded||{})}`.toLowerCase().includes(q))continue;out.push(t);}return out.reverse();
  }

  getDataTypeAnalysis({ deviceKey, channelId, unitId, slave, fc, address, count=4 } = {}) {
    const ref=deviceKey||(unitId??slave);let key;try{key=this.resolveDeviceKey(ref,channelId||null);}catch(e){return{words:[],interpretations:[],error:e.message,code:e.code};}
    const functionCode=fc==null||fc===''?null:Number(fc),start=Number(address),qty=Math.max(1,Math.min(4,Number(count)||4));
    if(!key||!Number.isInteger(start))return{words:[],interpretations:[],error:'device and address are required'};
    const parsed=parseDeviceKey(key),words=[];let chosenFc=functionCode;
    for(let i=0;i<qty;i++){let reg=null;if(Number.isFinite(chosenFc))reg=this.registers.get(`${key}:${chosenFc}:${start+i}`);if(!reg){const candidates=[...this.registers.values()].filter(r=>r.deviceKey===key&&r.address===start+i).sort((a,b)=>([3,4,6,16,23].indexOf(a.functionCode)-[3,4,6,16,23].indexOf(b.functionCode)));reg=candidates[0];if(reg&&!Number.isFinite(chosenFc))chosenFc=reg.functionCode;}if(!reg||!Number.isFinite(Number(reg.lastValue)))break;words.push(Number(reg.lastValue)&0xFFFF);}
    return{deviceKey:key,channelId:parsed.channelId,unitId:parsed.unitId,slaveId:parsed.unitId,functionCode:chosenFc,startAddress:start,...analyzeWords(words)};
  }

  getChannels() {
    const counts=new Map();
    for(const d of this.slaves.values())counts.set(d.channelId,(counts.get(d.channelId)||0)+1);
    return [...this.channels.values()].map(c=>({...c,deviceCount:counts.get(c.channelId)||0})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }

  getTransportSummary(){const out={RTU:{frames:0,requests:0,responses:0,timeouts:0,bytes:0,devices:0},TCP:{frames:0,requests:0,responses:0,timeouts:0,bytes:0,devices:0}};for(const t of this.transactions){const k=t.transport==='TCP'?'TCP':'RTU',x=out[k];if(t.direction==='TIMEOUT'){x.timeouts++;continue;}x.frames++;x.bytes+=Number(t.byteLength||0);if(t.direction==='REQ')x.requests++;if(t.direction==='RSP')x.responses++;}for(const d of this.slaves.values())out[d.transport==='TCP'?'TCP':'RTU'].devices++;return out;}

  getStatus(){const s=super.getStatus();s.channels=this.getChannels();s.transports=this.getTransportSummary();return s;}
  getAnalysis(){const a=super.getAnalysis();a.channels=this.getChannels();return a;}

  exportCapture(){return{format:'mbcap',version:2,schemaVersion:2,createdAt:new Date().toISOString(),config:this.config,channels:this.getChannels(),totals:this.getStatus().totals,transactions:this.transactions.map(t=>({...t}))};}

  _normalizeImportedEvent(source, channelLookup = new Map()) {
    const event={...source};
    const transport=event.transport||event.decoded?.transport||'RTU';
    let channel=event.channelId?channelLookup.get(event.channelId):null;
    if(!channel&&event.channel)channel=event.channel;
    if(!channel)channel=fallbackChannel(transport);
    const identity=normalizeIdentity({transport,channel,channelId:event.channelId||channel.channelId,deviceKey:event.deviceKey,unitId:event.unitId??event.slaveId??event.decoded?.unitId,slaveId:event.slaveId??event.decoded?.slaveId});
    this.registerChannel(identity.channel);
    Object.assign(event,identityFields(identity),{channel:identity.channel});
    event.decoded=this._stampDecoded(event.decoded||{},identity);if(event.request)event.request=this._stampDecoded(event.request,identity);
    return event;
  }

  loadCapture(capture,{emit=false}={}){
    if(!capture||!Array.isArray(capture.transactions))throw new Error('Invalid capture file: transactions array is missing.');
    const version=Number(capture.schemaVersion||capture.version||1),warnings=[];this.clearCapture();this.captureSource='capture';
    const lookup=new Map();if(Array.isArray(capture.channels))for(const c of capture.channels){const saved=this.registerChannel(c);lookup.set(saved.channelId,saved);}
    if(version<2)warnings.push('Legacy capture migrated in memory. Original endpoint/channel identity was not recorded; RTU and TCP events are assigned to explicit legacy channels.');
    for(const source of capture.transactions){const event=this._normalizeImportedEvent(source,lookup);event.id=++this.sequence;if(event.direction==='TIMEOUT'||event.timeout){this.timeouts++;this.transactions.push(event);const s=this._ensureDevice(event,event.timestamp);s.timeouts++;s.lastTimeoutAt=event.timestamp;const descriptor=this._descriptor(event.request||event.decoded||event);const p=this.pollPatterns.get(descriptor.key);if(p)p.timeouts++;this._bucket(event.timestamp).timeouts++;if(emit)this.emit('transaction',event);}else this._ingestEvent(event,{emit,countAsFrame:true});}
    if(Number.isFinite(Number(capture.totals?.noiseBytes)))this.noiseBytes=Number(capture.totals.noiseBytes);this.emit('capture-loaded',{transactions:capture.transactions.length,version,warnings});const status=this.getStatus();status.captureMigrationWarnings=warnings;return status;
  }
}

module.exports={PlatformRuntimeState};
