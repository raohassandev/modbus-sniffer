'use strict';

module.exports = Object.freeze({
  protocol: require('./protocol'),
  ...require('./events'),
  ...require('./connectionBroker'),
  ...require('./transports/virtualLoopback'),
  ...require('./transports/receiveQueue'),
  ...require('./transports/tcpStreamFramer'),
  ...require('./transports/networkAddresses'),
  ...require('./transports/tcpClientTransport'),
  ...require('./transports/tcpServerTransport'),
  ...require('./transports/serialFramers'),
  ...require('./transports/echoSuppressor'),
  ...require('./transports/serialTransport'),
  ...require('./master/asyncSemaphore'),
  ...require('./master/masterEngine'),
  ...require('./slave/virtualDevice'),
  ...require('./slave/virtualSlaveServer'),
});
