import assert from 'node:assert/strict';
import test from 'node:test';
import {
  intToHex8,
  hex8ToInt,
  reverseHexBytes,
  intToWireHex,
  floatToHex8BE,
  hex8BEToFloat,
  encodeParamString,
  decodeDataPayload,
} from '../src/utils/hexCodec.js';
import { buildIstResponse } from '../src/utils/timeSync.js';

test('SYSTEM_ID conversions and byte-order reversal', () => {
  // Integer 3422 -> 0x00000D5E
  assert.equal(intToHex8(3422), '00000D5E');
  assert.equal(hex8ToInt('00000D5E'), 3422);

  // Wire order (Little Endian): 5E 0D 00 00
  assert.equal(reverseHexBytes('00000D5E'), '5E0D0000');
  assert.equal(reverseHexBytes('5E0D0000'), '00000D5E');
  assert.equal(intToWireHex(3422), '5E0D0000');
});

test('IEEE-754 Float conversions', () => {
  assert.equal(floatToHex8BE(1.0), '3F800000');
  assert.equal(floatToHex8BE(0.0), '00000000');
  assert.ok(Math.abs(hex8BEToFloat('3F800000') - 1.0) < 0.0001);
});

test('encodeParamString: 30-char fixed header format', () => {
  const param = {
    source_type: 12,
    para_type: 0,
    rs485_mode: 0,
    rs485_data_type: 1,
    baud_rate: 3,
    data_bits: 0,
    parity: 0,
    stop_bits: 0,
    timeout_ms: 3000,
    mul_factor: 1.0,
    add_factor: 0.0,
    modbus_req_hex: '010300000002C40B',
    param_name: 'Active Power',
  };

  const encoded = encodeParamString(param);
  // Header should be 30 characters:
  // [00-01]: "12"
  // [02-03]: "00"
  // [04]: "0"
  // [05]: "1"
  // [06]: "3"
  // [07]: "0"
  // [08]: "0"
  // [09]: "0"
  // [10-13]: "3000"
  // [14-21]: "3F800000"
  // [22-29]: "00000000"
  // Total 30 chars
  const header = encoded.substring(0, 30);
  assert.equal(header, '120001300030003F80000000000000');
  assert.equal(header.length, 30);

  // Name should be capped at 9 characters: "Active Po"
  assert.equal(encoded, '120001300030003F80000000000000010300000002C40B#Active Po');
});

test('decodeDataPayload: test vector from guide', () => {
  // Test vector from section 5.3 of guide:
  // Header: Write Cnt = 1, SysID = 5E0D0000, Timestamp = 19/11/26 15:30:00, acquisition counter = 1, Params = 2
  // Body: Param 0 = 50.12f (E17A4842), Param 1 = 100.0f (0000C842)
  const hex = '010000005E0D0000191126153000280100000100000002000000E17A48420000C842';
  const decoded = decodeDataPayload(hex);

  assert.equal(decoded.writeCounter, 1);
  assert.equal(decoded.systemId, '5E0D0000');
  assert.equal(decoded.signalStrength, 28);
  assert.equal(decoded.acquisitionCounter, 1);
  assert.equal(decoded.paramCount, 2);

  // Timestamp: DD=19, MM=11, YY=26 -> 2026-11-19 15:30:00
  assert.equal(decoded.timestamp.getFullYear(), 2026);
  assert.equal(decoded.timestamp.getMonth(), 10); // 0-indexed November
  assert.equal(decoded.timestamp.getDate(), 19);
  assert.equal(decoded.timestamp.getHours(), 15);
  assert.equal(decoded.timestamp.getMinutes(), 30);
  assert.equal(decoded.timestamp.getSeconds(), 0);

  // Relays: byte 15 is 0x01 (relay1=true), byte 16 is 0x00, byte 17 is 0x00
  assert.equal(decoded.relays[0], true);
  assert.equal(decoded.relays[1], false);
  assert.equal(decoded.relays[2], false);

  // Values
  assert.equal(decoded.values.length, 2);
  assert.equal(decoded.values[0].index, 0);
  assert.ok(Math.abs(decoded.values[0].value - 50.12) < 0.01);
  assert.equal(decoded.values[0].status, 'OK');

  assert.equal(decoded.values[1].index, 1);
  assert.ok(Math.abs(decoded.values[1].value - 100.0) < 0.01);
  assert.equal(decoded.values[1].status, 'OK');
});

test('decodeDataPayload: sentinel values (-2222.0 and -3333.0)', () => {
  // Little endian bytes for -2222.0f: 00 E0 0A C5
  // Little endian bytes for -3333.0f: 00 50 50 C5
  const headerHex = '010000005E0D0000191126153000280000000100000002000000';
  const valuesHex = '00E00AC5005050C5';
  const decoded = decodeDataPayload(headerHex + valuesHex);

  assert.equal(decoded.values[0].status, 'TIMEOUT');
  assert.equal(decoded.values[0].value, null);

  assert.equal(decoded.values[1].status, 'COMM_ERROR');
  assert.equal(decoded.values[1].value, null);
});

test('buildIstResponse: format compliance', () => {
  const fixedDate = new Date('2026-11-20T12:00:00Z'); // 12:00 UTC = 17:30 IST
  const res = buildIstResponse(fixedDate);
  assert.equal(res, 'Packet Inserted >$IST=20261120173000#');
});
