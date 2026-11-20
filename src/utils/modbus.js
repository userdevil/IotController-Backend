/**
 * Modbus RTU CRC-16 and frame utilities.
 *
 * Implements the standard Modbus CRC-16 (polynomial 0xA001, initial 0xFFFF).
 * In Modbus RTU serial packets, the CRC-16 low byte is transmitted first,
 * followed by the high byte.
 */

/**
 * Calculate Modbus RTU CRC-16 for a Buffer or hex string.
 * @param {Buffer|string} data - Buffer or hex string
 * @returns {{ crc: number, lowByte: number, highByte: number, hexLE: string }}
 */
export function calculateModbusCRC(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'hex');

  let crc = 0xffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc = crc >> 1;
      }
    }
  }

  // Modbus sends Low byte first, then High byte
  const lowByte = crc & 0xff;
  const highByte = (crc >> 8) & 0xff;

  const hexLE =
    lowByte.toString(16).padStart(2, '0').toUpperCase() +
    highByte.toString(16).padStart(2, '0').toUpperCase();

  return {
    crc,
    lowByte,
    highByte,
    hexLE, // e.g. "C40B"
  };
}

/**
 * Build a complete Modbus RTU request frame with CRC16.
 * Typically Function Code 01, 02, 03, or 04.
 *
 * @param {number} slaveId - Modbus Slave ID (1-247)
 * @param {number} functionCode - e.g. 1 (Coils), 2 (Discrete), 3 (Holding Regs), 4 (Input Regs)
 * @param {number} startRegister - 0-based start address (0-65535)
 * @param {number} count - number of points/registers to read (1-125)
 * @returns {{ payloadHex: string, crcHex: string, fullPacketHex: string }}
 */
export function buildModbusRtuRequest(slaveId, functionCode, startRegister, count) {
  const buf = Buffer.alloc(6);
  buf.writeUInt8(slaveId & 0xff, 0);
  buf.writeUInt8(functionCode & 0xff, 1);
  buf.writeUInt16BE(startRegister & 0xffff, 2);
  buf.writeUInt16BE(count & 0xffff, 4);

  const payloadHex = buf.toString('hex').toUpperCase();
  const { hexLE } = calculateModbusCRC(buf);
  const fullPacketHex = `${payloadHex}${hexLE}`;

  return {
    payloadHex,
    crcHex: hexLE,
    fullPacketHex,
  };
}

/**
 * Validate a Modbus RTU frame hex string and check its CRC.
 * @param {string} hexStr - Modbus hex string (e.g. "010300000002C40B")
 * @returns {{ valid: boolean, error?: string, slaveId?: number, functionCode?: number }}
 */
export function validateModbusRtuRequest(hexStr) {
  if (!hexStr || typeof hexStr !== 'string') {
    return { valid: false, error: 'Empty or invalid hex string' };
  }

  const cleaned = hexStr.trim().replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]+$/.test(cleaned)) {
    return { valid: false, error: 'Contains non-hexadecimal characters' };
  }

  if (cleaned.length % 2 !== 0) {
    return { valid: false, error: 'Hex string must have an even number of characters' };
  }

  if (cleaned.length < 8) {
    return { valid: false, error: 'Packet too short for Modbus RTU (minimum 4 bytes)' };
  }

  if (cleaned.length > 29) {
    return { valid: false, error: 'Firmware limit exceeded: max 29 characters (15 bytes)' };
  }

  const buf = Buffer.from(cleaned, 'hex');
  const payload = buf.subarray(0, buf.length - 2);
  const expectedCrcLE =
    buf[buf.length - 2].toString(16).padStart(2, '0').toUpperCase() +
    buf[buf.length - 1].toString(16).padStart(2, '0').toUpperCase();

  const { hexLE: calculatedCrcLE } = calculateModbusCRC(payload);

  if (expectedCrcLE !== calculatedCrcLE) {
    return {
      valid: false,
      error: `CRC mismatch: packet has ${expectedCrcLE}, calculated is ${calculatedCrcLE}`,
    };
  }

  return {
    valid: true,
    slaveId: buf[0],
    functionCode: buf[1],
  };
}
