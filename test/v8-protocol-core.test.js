'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../src/v8/protocol');

function hex(buf) {
  return Buffer.from(buf).toString('hex').toUpperCase();
}

test('v8 protocol core uses one PDU across RTU, ASCII and TCP framing', () => {
  const pdu = protocol.encodeReadRequest({ functionCode: protocol.FC.READ_HOLDING_REGISTERS, address: 0, quantity: 10 });
  assert.equal(hex(pdu), '030000000A');

  const rtu = protocol.encodeRtuAdu(1, pdu);
  assert.equal(hex(rtu), '01030000000AC5CD');
  const decodedRtu = protocol.decodeRtuAdu(rtu);
  assert.equal(decodedRtu.unitId, 1);
  assert.equal(hex(decodedRtu.pdu), hex(pdu));

  const ascii = protocol.encodeAsciiAdu(1, pdu);
  assert.equal(ascii.toString('ascii'), ':01030000000AF2\r\n');
  const decodedAscii = protocol.decodeAsciiAdu(ascii);
  assert.equal(decodedAscii.unitId, 1);
  assert.equal(hex(decodedAscii.pdu), hex(pdu));

  const tcp = protocol.encodeTcpAdu({ transactionId: 1, unitId: 1, pdu });
  assert.equal(hex(tcp), '00010000000601030000000A');
  const decodedTcp = protocol.decodeTcpAdu(tcp);
  assert.equal(decodedTcp.transactionId, 1);
  assert.equal(decodedTcp.protocolId, 0);
  assert.equal(decodedTcp.unitId, 1);
  assert.equal(hex(decodedTcp.pdu), hex(pdu));
});

test('v8 protocol core rejects bad RTU CRC, bad ASCII LRC and MBAP length mismatch with structured codes', () => {
  const pdu = protocol.encodeReadRequest({ functionCode: protocol.FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 });

  const badRtu = protocol.encodeRtuAdu(1, pdu);
  badRtu[badRtu.length - 1] ^= 0xFF;
  assert.throws(() => protocol.decodeRtuAdu(badRtu), (error) => error.code === 'CRC_MISMATCH');

  const badAscii = Buffer.from(protocol.encodeAsciiAdu(1, pdu));
  badAscii[badAscii.length - 4] = badAscii[badAscii.length - 4] === 0x30 ? 0x31 : 0x30;
  assert.throws(() => protocol.decodeAsciiAdu(badAscii), (error) => error.code === 'LRC_MISMATCH');

  const badTcp = protocol.encodeTcpAdu({ transactionId: 7, unitId: 1, pdu });
  badTcp.writeUInt16BE(7, 4);
  assert.throws(() => protocol.decodeTcpAdu(badTcp), (error) => error.code === 'MBAP_LENGTH_MISMATCH');
});

test('v8 read request and response codecs enforce Modbus quantities and preserve values', () => {
  assert.throws(
    () => protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 126 }),
    (error) => error.code === 'QUANTITY_OUT_OF_RANGE',
  );

  const response = protocol.encodeReadRegistersResponse({ functionCode: 3, values: [0x1234, 0xABCD] });
  assert.equal(hex(response), '03041234ABCD');
  assert.deepEqual(protocol.decodeReadRegistersResponse(response, { expectedQuantity: 2 }).values, [0x1234, 0xABCD]);

  const bits = protocol.encodeReadBitsResponse({ functionCode: 1, values: [true, false, true, true, false, false, false, true, true] });
  const decoded = protocol.decodeReadBitsResponse(bits, { expectedQuantity: 9 });
  assert.deepEqual(decoded.values, [true, false, true, true, false, false, false, true, true]);
});

test('v8 write codecs validate single and multiple values', () => {
  const coil = protocol.encodeWriteSingleCoilRequest({ address: 7, value: true });
  assert.equal(hex(coil), '050007FF00');
  assert.deepEqual(protocol.decodeWriteSingleRequest(coil), {
    functionCode: 5,
    address: 7,
    value: true,
    rawValue: 0xFF00,
  });

  assert.throws(
    () => protocol.decodeWriteSingleRequest(Buffer.from('0500071234', 'hex')),
    (error) => error.code === 'INVALID_COIL_VALUE',
  );

  const regs = protocol.encodeWriteMultipleRegistersRequest({ address: 100, values: [1, 2, 65535] });
  const decodedRegs = protocol.decodeWriteMultipleRequest(regs);
  assert.equal(decodedRegs.address, 100);
  assert.equal(decodedRegs.quantity, 3);
  assert.deepEqual(decodedRegs.values, [1, 2, 65535]);

  const coils = protocol.encodeWriteMultipleCoilsRequest({ address: 20, values: [true, false, true, true, false, true] });
  const decodedCoils = protocol.decodeWriteMultipleRequest(coils);
  assert.deepEqual(decodedCoils.values, [true, false, true, true, false, true]);
});

test('v8 FC23 request preserves separate read/write windows', () => {
  const pdu = protocol.encodeReadWriteMultipleRegistersRequest({
    readAddress: 1000,
    readQuantity: 4,
    writeAddress: 2000,
    values: [10, 20, 30],
  });
  const decoded = protocol.decodeReadWriteMultipleRegistersRequest(pdu);
  assert.deepEqual(decoded, {
    functionCode: 0x17,
    readAddress: 1000,
    readQuantity: 4,
    writeAddress: 2000,
    writeQuantity: 3,
    values: [10, 20, 30],
  });
});

test('v8 FC43 Device Identification supports segmented object metadata', () => {
  const request = protocol.encodeDeviceIdRequest({ readDeviceIdCode: 1, objectId: 0 });
  assert.equal(hex(request), '2B0E0100');
  assert.deepEqual(protocol.decodeDeviceIdRequest(request), {
    functionCode: 0x2B,
    meiType: 0x0E,
    readDeviceIdCode: 1,
    objectId: 0,
  });

  const response = protocol.encodeDeviceIdResponse({
    readDeviceIdCode: 1,
    conformityLevel: 2,
    moreFollows: true,
    nextObjectId: 2,
    objects: [
      { id: 0, value: 'Automatrix' },
      { id: 1, value: 'Virtual Meter' },
    ],
  });
  const decoded = protocol.decodeDeviceIdResponse(response);
  assert.equal(decoded.moreFollows, true);
  assert.equal(decoded.nextObjectId, 2);
  assert.equal(decoded.objects[0].text, 'Automatrix');
  assert.equal(decoded.objects[1].text, 'Virtual Meter');
});

test('v8 canonical message model preserves vendor functions and normalizes exceptions', () => {
  const vendor = protocol.parsePdu({ unitId: 9, pdu: Buffer.from([0x41, 0xAA, 0xBB]) });
  assert.equal(vendor.kind, 'message');
  assert.equal(vendor.functionCode, 0x41);
  assert.equal(hex(vendor.data), 'AABB');

  const exception = protocol.createException({ unitId: 9, functionCode: 3, exceptionCode: 2 });
  assert.equal(exception.kind, 'exception');
  assert.equal(exception.functionCode, 0x83);
  assert.equal(exception.originalFunctionCode, 3);
  assert.equal(exception.exceptionCode, 2);
});
