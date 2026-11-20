/**
 * Hex / binary codec utilities for the IoT Controller wire protocol.
 *
 * Key conventions from the firmware guide:
 *   - SYSTEM_ID in DB is stored in wire-order (little-endian bytes as hex),
 *     e.g. integer 3422 = 0x00000D5E → LE bytes 5E 0D 00 00 → "5E0D0000"
 *   - JSON config endpoints use standard hex "00000D5E"
 *   - Telemetry wire header encodes SystemID as UINT32 LE
 *   - Compact parameter string has a 30-char fixed header
 */

// ─── SYSTEM_ID Helpers ──────────────────────────────────────────────

/**
 * Convert an integer to 8-char uppercase hex (big-endian / standard).
 * e.g. 3422 → "00000D5E"
 */
export function intToHex8(n) {
  return n.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Convert 8-char hex string to integer.
 * e.g. "00000D5E" → 3422
 */
export function hex8ToInt(hex) {
  return parseInt(hex, 16);
}

/**
 * Reverse byte-pairs in an 8-char hex string.
 * Converts between wire-order (LE) ↔ config-order (BE).
 * e.g. "5E0D0000" ↔ "00000D5E"
 */
export function reverseHexBytes(hex8) {
  const bytes = hex8.match(/.{2}/g);
  return bytes.reverse().join('').toUpperCase();
}

/**
 * Convert integer to wire-order (little-endian) 8-char hex string.
 * e.g. 3422 → "5E0D0000"
 */
export function intToWireHex(n) {
  return reverseHexBytes(intToHex8(n));
}

// ─── IEEE-754 Float Helpers ─────────────────────────────────────────

/**
 * Convert IEEE-754 float to 8-char big-endian hex string.
 * Used for multiplier/addition factor in parameter config.
 * e.g. 1.0 → "3F800000"
 */
export function floatToHex8BE(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return buf.toString('hex').toUpperCase();
}

/**
 * Convert 8-char big-endian hex string to IEEE-754 float.
 * e.g. "3F800000" → 1.0
 */
export function hex8BEToFloat(hex) {
  const buf = Buffer.from(hex, 'hex');
  return buf.readFloatBE(0);
}

// ─── Compact Parameter String ───────────────────────────────────────

/**
 * Build a compact parameter string from a device_parameters DB row.
 * Format: 30-char fixed header + modbus hex + "#" + name (max 9 chars)
 *
 * Header layout (30 chars):
 *   [00-01] source (2 decimal digits)
 *   [02-03] type   (2 decimal digits)
 *   [04]    RS485 mode
 *   [05]    RS485 data type
 *   [06]    baud rate
 *   [07]    data bits
 *   [08]    parity
 *   [09]    stop bits
 *   [10-13] timeout (4 decimal digits)
 *   [14-21] multiplier  (8 hex chars, IEEE-754 BE)
 *   [22-29] add factor  (8 hex chars, IEEE-754 BE)
 */
export function encodeParamString(param) {
  const header = [
    String(param.source_type ?? 0).padStart(2, '0'),
    String(param.para_type ?? 0).padStart(2, '0'),
    String(param.rs485_mode ?? 0),
    String(param.rs485_data_type ?? 0),
    String(param.baud_rate ?? 0),
    String(param.data_bits ?? 0),
    String(param.parity ?? 0),
    String(param.stop_bits ?? 0),
    String(param.timeout_ms ?? 3000).padStart(4, '0'),
    floatToHex8BE(param.mul_factor ?? 1.0),
    floatToHex8BE(param.add_factor ?? 0.0),
  ].join('');

  const modbusHex = param.modbus_req_hex || '';
  const name = (param.param_name || '').substring(0, 9);

  return `${header}${modbusHex}#${name}`;
}

// ─── Telemetry Payload Decoder ──────────────────────────────────────

/**
 * Decode the DATA000 hex payload from the device.
 *
 * Wire header (52 hex chars = 26 bytes):
 *   [00-07] WriteCounter        UINT32 LE
 *   [08-15] SystemID            UINT32 LE (wire-order hex)
 *   [16-27] Timestamp           Decimal digit pairs DDMMYYHHMMSS
 *   [28-29] SignalStrength      Decimal text (AT+CSQ index)
 *   [30-31] Relay1              ASCII '0'/'1' (or binary 0x00/0x01)
 *   [32-33] Relay2              ASCII '0'/'1'
 *   [34-35] Relay3              ASCII '0'/'1'
 *   [36-43] AcquisitionCounter  UINT32 LE
 *   [44-51] ParamCount          UINT32 LE
 *
 * Body: N × 8 hex chars (IEEE-754 LE floats)
 *   Sentinel -2222.0 → TIMEOUT
 *   Sentinel -3333.0 → COMM_ERROR
 */
export function decodeDataPayload(hexStr) {
  if (hexStr.length < 52) {
    throw new Error('Payload too short for 26-byte wire header (need ≥52 hex chars)');
  }

  const buf = Buffer.from(hexStr, 'hex');

  // ── Header ──
  const writeCounter = buf.readUInt32LE(0);
  const systemId = buf.subarray(4, 8).toString('hex').toUpperCase(); // wire-order

  // Timestamp: decimal digit pairs from hex string chars 16-27
  const day    = parseInt(hexStr.substring(16, 18), 10);
  const month  = parseInt(hexStr.substring(18, 20), 10);
  const year   = 2000 + parseInt(hexStr.substring(20, 22), 10);
  const hour   = parseInt(hexStr.substring(22, 24), 10);
  const minute = parseInt(hexStr.substring(24, 26), 10);
  const second = parseInt(hexStr.substring(26, 28), 10);
  const timestamp = new Date(year, month - 1, day, hour, minute, second);

  // Signal strength: 2 decimal characters from hex string
  const signalStrength = parseInt(hexStr.substring(28, 30), 10);

  // Relays: firmware writes ASCII '0'(0x30)/'1'(0x31) or binary 0x00/0x01
  const relay1 = buf[15] === 1 || buf[15] === 0x31;
  const relay2 = buf[16] === 1 || buf[16] === 0x31;
  const relay3 = buf[17] === 1 || buf[17] === 0x31;

  const acquisitionCounter = buf.readUInt32LE(18);
  const paramCount = buf.readUInt32LE(22);

  // ── Sensor Values ──
  const values = [];
  let offset = 26;
  for (let i = 0; i < paramCount; i++) {
    if (offset + 4 > buf.length) break;

    const floatVal = buf.readFloatLE(offset);
    let status = 'OK';

    if (Math.abs(floatVal - (-2222.0)) < 0.5) {
      status = 'TIMEOUT';
    } else if (Math.abs(floatVal - (-3333.0)) < 0.5) {
      status = 'COMM_ERROR';
    }

    values.push({
      index: i,
      value: status === 'OK' ? floatVal : null,
      status,
    });
    offset += 4;
  }

  return {
    writeCounter,
    systemId,
    timestamp,
    signalStrength,
    relays: [relay1, relay2, relay3],
    acquisitionCounter,
    paramCount,
    values,
  };
}
