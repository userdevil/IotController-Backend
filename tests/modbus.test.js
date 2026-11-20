import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateModbusCRC,
  buildModbusRtuRequest,
  validateModbusRtuRequest,
} from '../src/utils/modbus.js';

test('Modbus CRC-16 against guide test vectors', () => {
  // Vector 1 from guide: 01 03 00 00 00 02 -> CRC LE: C40B (packet: 010300000002C40B)
  const v1 = calculateModbusCRC('010300000002');
  assert.equal(v1.hexLE, 'C40B');

  // Vector 2 from guide: 01 03 00 02 00 02 -> CRC LE: 65CB (packet: 01030002000265CB)
  const v2 = calculateModbusCRC('010300020002');
  assert.equal(v2.hexLE, '65CB');
});

test('buildModbusRtuRequest builds correct packet', () => {
  const req = buildModbusRtuRequest(1, 3, 0, 2);
  assert.equal(req.payloadHex, '010300000002');
  assert.equal(req.crcHex, 'C40B');
  assert.equal(req.fullPacketHex, '010300000002C40B');
});

test('validateModbusRtuRequest: valid and invalid frames', () => {
  // Valid frame
  const ok = validateModbusRtuRequest('010300000002C40B');
  assert.equal(ok.valid, true);
  assert.equal(ok.slaveId, 1);
  assert.equal(ok.functionCode, 3);

  // CRC error
  const badCrc = validateModbusRtuRequest('010300000002FFFF');
  assert.equal(badCrc.valid, false);
  assert.ok(badCrc.error.includes('CRC mismatch'));

  // Too long (>29 chars firmware limit)
  const tooLong = validateModbusRtuRequest('010300000002C40B00000000000000000000');
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.error.includes('Firmware limit'));
});
