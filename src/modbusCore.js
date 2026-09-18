'use strict';

// Canonical shared Modbus engineering core boundary.
// Product modes should consume protocol/transport/runtime primitives through
// this facade instead of importing page/workbench implementation paths directly.

const { ConnectionBroker } = require('./v8/connectionBroker');
const { MasterEngine } = require('./v8/master/masterEngine');
const { SerialTransport } = require('./v8/transports/serialTransport');
const { TcpClientTransport } = require('./v8/transports/tcpClientTransport');
const { TcpServerTransport } = require('./v8/transports/tcpServerTransport');
const { TlsClientTransport, TlsServerTransport } = require('./v8/transports/tlsTransport');
const { UdpClientTransport, UdpServerTransport } = require('./v8/transports/udpTransport');
const { TunnelTcpClientTransport, TunnelTcpServerTransport } = require('./v8/transports/tunnelTransport');
const { listLocalAddresses, recommendLocalAddress } = require('./v8/transports/networkAddresses');
const protocol = require('./v8/protocol');
const { VirtualSlaveServer } = require('./v8/slave/virtualSlaveServer');
const { VirtualDevice, VirtualDeviceError, MemoryArea, normalizeWritableAreas } = require('./v8/slave/virtualDevice');
const { WriteAuditTrail, WriteSafetyController, WriteSafetyError, describeWritePdu } = require('./v8/master/writeSafety');
const registerCodec = require('./register/registerCodec');
const { RawFrameStudio, RawFrameStudioError, parseHexText, maskMatches } = require('./v8/testCenter/rawFrameStudio');

module.exports = Object.freeze({
  ConnectionBroker,
  MasterEngine,
  SerialTransport,
  TcpClientTransport,
  TcpServerTransport,
  TlsClientTransport,
  TlsServerTransport,
  UdpClientTransport,
  UdpServerTransport,
  TunnelTcpClientTransport,
  TunnelTcpServerTransport,
  listLocalAddresses,
  recommendLocalAddress,
  protocol,
  VirtualSlaveServer,
  VirtualDevice,
  VirtualDeviceError,
  MemoryArea,
  normalizeWritableAreas,
  WriteAuditTrail,
  WriteSafetyController,
  WriteSafetyError,
  describeWritePdu,
  registerCodec,
  RawFrameStudio,
  RawFrameStudioError,
  parseHexText,
  maskMatches,
});
