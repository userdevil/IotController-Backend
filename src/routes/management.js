import { Router } from 'express';
import pool from '../db/pool.js';
import { reverseHexBytes, encodeParamString, intToWireHex } from '../utils/hexCodec.js';
import {
  calculateModbusCRC,
  buildModbusRtuRequest,
  validateModbusRtuRequest,
} from '../utils/modbus.js';

const router = Router();

// Helper to normalize system ID: allows passing wire-order or config-order
async function findDeviceByAnyId(idStr) {
  if (!idStr) return null;
  const clean = idStr.trim().toUpperCase();

  // Try direct match (wire-order)
  let res = await pool.query('SELECT * FROM devices WHERE system_id = $1', [clean]);
  if (res.rows.length > 0) return res.rows[0];

  // Try reversed (config-order)
  if (clean.length === 8) {
    const reversed = reverseHexBytes(clean);
    res = await pool.query('SELECT * FROM devices WHERE system_id = $1', [reversed]);
    if (res.rows.length > 0) return res.rows[0];
  }

  return null;
}

// ─── 1. Devices Management ──────────────────────────────────────────

/**
 * GET /api/manage/devices
 * List all devices with parameter counts and relay counts
 */
router.get('/devices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.*,
        COALESCE(p.param_count, 0)::int AS param_count,
        COALESCE(r.relay_count, 0)::int AS relay_count
      FROM devices d
      LEFT JOIN (
        SELECT system_id, COUNT(*) AS param_count
        FROM device_parameters
        GROUP BY system_id
      ) p ON d.system_id = p.system_id
      LEFT JOIN (
        SELECT system_id, COUNT(*) AS relay_count
        FROM relay_modules
        GROUP BY system_id
      ) r ON d.system_id = r.system_id
      ORDER BY d.created_at DESC
    `);

    const devices = result.rows.map((row) => ({
      ...row,
      config_system_id: reverseHexBytes(row.system_id),
    }));

    return res.json({ devices });
  } catch (err) {
    console.error('[MANAGE] Error listing devices:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manage/devices
 * Create or update a device
 */
router.post('/devices', async (req, res) => {
  try {
    const {
      system_id,
      imei,
      name,
      server_add,
      server_port,
      server_path,
      acq_interval_min,
      trans_interval_min,
      mqtt_broker,
      mqtt_port,
      mqtt_client_id,
      mqtt_username,
      mqtt_password,
      mqtt_command_topic,
      mqtt_status_topic,
    } = req.body;

    if (!imei) {
      return res.status(400).json({ error: 'IMEI is required' });
    }

    let wireId = system_id ? system_id.trim().toUpperCase() : null;

    // Check if device exists by IMEI or system_id
    let existing;
    if (wireId) {
      existing = await findDeviceByAnyId(wireId);
    }
    if (!existing) {
      const imeiCheck = await pool.query('SELECT * FROM devices WHERE imei = $1', [imei]);
      if (imeiCheck.rows.length > 0) existing = imeiCheck.rows[0];
    }

    if (existing) {
      // Update existing device
      wireId = existing.system_id;
      await pool.query(
        `UPDATE devices SET
          name = COALESCE($1, name),
          server_add = COALESCE($2, server_add),
          server_port = COALESCE($3, server_port),
          server_path = COALESCE($4, server_path),
          acq_interval_min = COALESCE($5, acq_interval_min),
          trans_interval_min = COALESCE($6, trans_interval_min),
          mqtt_broker = COALESCE($7, mqtt_broker),
          mqtt_port = COALESCE($8, mqtt_port),
          mqtt_client_id = COALESCE($9, mqtt_client_id),
          mqtt_username = COALESCE($10, mqtt_username),
          mqtt_password = COALESCE($11, mqtt_password),
          mqtt_command_topic = COALESCE($12, mqtt_command_topic),
          mqtt_status_topic = COALESCE($13, mqtt_status_topic)
        WHERE system_id = $14`,
        [
          name,
          server_add,
          server_port,
          server_path,
          acq_interval_min,
          trans_interval_min,
          mqtt_broker,
          mqtt_port,
          mqtt_client_id,
          mqtt_username,
          mqtt_password,
          mqtt_command_topic,
          mqtt_status_topic,
          wireId,
        ]
      );
    } else {
      // Create new device: generate system_id if not provided
      if (!wireId) {
        const seqRes = await pool.query("SELECT nextval('device_id_seq') AS id");
        wireId = intToWireHex(parseInt(seqRes.rows[0].id, 10));
      }

      await pool.query(
        `INSERT INTO devices (
          system_id, imei, name, server_add, server_port, server_path,
          acq_interval_min, trans_interval_min,
          mqtt_broker, mqtt_port, mqtt_client_id, mqtt_username, mqtt_password,
          mqtt_command_topic, mqtt_status_topic
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          wireId,
          imei,
          name || `Device-${wireId}`,
          server_add || process.env.DEFAULT_SERVER_ADD || 'localhost',
          server_port || process.env.DEFAULT_SERVER_PORT || '8080',
          server_path || process.env.DEFAULT_SERVER_PATH || '/',
          acq_interval_min || 1,
          trans_interval_min || 1,
          mqtt_broker || 'broker.example.net',
          mqtt_port || 1883,
          mqtt_client_id || `device-${reverseHexBytes(wireId)}`,
          mqtt_username || '',
          mqtt_password || '',
          mqtt_command_topic || `devices/${reverseHexBytes(wireId)}/relay/set`,
          mqtt_status_topic || `devices/${reverseHexBytes(wireId)}/relay/status`,
        ]
      );
    }

    const saved = await pool.query('SELECT * FROM devices WHERE system_id = $1', [wireId]);
    return res.json({
      success: true,
      device: {
        ...saved.rows[0],
        config_system_id: reverseHexBytes(saved.rows[0].system_id),
      },
    });
  } catch (err) {
    console.error('[MANAGE] Error saving device:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/manage/devices/:systemId
 * Get a single device details
 */
router.get('/devices/:systemId', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    return res.json({
      device: {
        ...device,
        config_system_id: reverseHexBytes(device.system_id),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── 2. DAQ Parameters Management ───────────────────────────────────

/**
 * GET /api/manage/devices/:systemId/parameters
 * List all configured DAQ parameters for a device
 */
router.get('/devices/:systemId/parameters', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const result = await pool.query(
      `SELECT * FROM device_parameters
       WHERE system_id = $1
       ORDER BY param_index ASC`,
      [device.system_id]
    );

    // Compute preview compact string for each parameter
    const parameters = result.rows.map((row) => ({
      ...row,
      compact_wire_string: encodeParamString(row),
    }));

    return res.json({
      system_id: device.system_id,
      config_system_id: reverseHexBytes(device.system_id),
      parameters,
    });
  } catch (err) {
    console.error('[MANAGE] Error getting parameters:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manage/devices/:systemId/parameters
 * Create or update a parameter
 */
router.post('/devices/:systemId/parameters', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const {
      param_index,
      param_name,
      source_type,
      para_type,
      rs485_mode,
      rs485_data_type,
      baud_rate,
      data_bits,
      parity,
      stop_bits,
      timeout_ms,
      mul_factor,
      add_factor,
      modbus_req_hex,
    } = req.body;

    const index = parseInt(param_index, 10);
    if (isNaN(index) || index < 0 || index > 199) {
      return res.status(400).json({ error: 'Parameter index must be between 0 and 199' });
    }

    if (!param_name || typeof param_name !== 'string') {
      return res.status(400).json({ error: 'Parameter name is required' });
    }

    const trimmedName = param_name.trim().substring(0, 9);
    const cleanedModbusHex = (modbus_req_hex || '').trim().replace(/\s+/g, '').toUpperCase();

    if (cleanedModbusHex.length > 29) {
      return res
        .status(400)
        .json({ error: 'Modbus request hex cannot exceed 29 characters (firmware buffer limit)' });
    }

    // Optional validation of CRC if RS485 source and modbus hex is provided
    if (cleanedModbusHex.length >= 8) {
      const check = validateModbusRtuRequest(cleanedModbusHex);
      if (!check.valid) {
        return res.status(400).json({ error: `Invalid Modbus frame: ${check.error}` });
      }
    }

    // Upsert into device_parameters
    await pool.query(
      `INSERT INTO device_parameters (
        system_id, param_index, param_name, source_type, para_type,
        rs485_mode, rs485_data_type, baud_rate, data_bits, parity, stop_bits,
        timeout_ms, mul_factor, add_factor, modbus_req_hex
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (system_id, param_index) DO UPDATE SET
        param_name = EXCLUDED.param_name,
        source_type = EXCLUDED.source_type,
        para_type = EXCLUDED.para_type,
        rs485_mode = EXCLUDED.rs485_mode,
        rs485_data_type = EXCLUDED.rs485_data_type,
        baud_rate = EXCLUDED.baud_rate,
        data_bits = EXCLUDED.data_bits,
        parity = EXCLUDED.parity,
        stop_bits = EXCLUDED.stop_bits,
        timeout_ms = EXCLUDED.timeout_ms,
        mul_factor = EXCLUDED.mul_factor,
        add_factor = EXCLUDED.add_factor,
        modbus_req_hex = EXCLUDED.modbus_req_hex`,
      [
        device.system_id,
        index,
        trimmedName,
        source_type ?? 12,
        para_type ?? 0,
        rs485_mode ?? 0,
        rs485_data_type ?? 1,
        baud_rate ?? 0,
        data_bits ?? 0,
        parity ?? 0,
        stop_bits ?? 0,
        timeout_ms ?? 3000,
        mul_factor ?? 1.0,
        add_factor ?? 0.0,
        cleanedModbusHex,
      ]
    );

    // Update count in devices table
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM device_parameters WHERE system_id = $1',
      [device.system_id]
    );
    await pool.query('UPDATE devices SET no_of_parameters = $1 WHERE system_id = $2', [
      countRes.rows[0].cnt,
      device.system_id,
    ]);

    const saved = await pool.query(
      'SELECT * FROM device_parameters WHERE system_id = $1 AND param_index = $2',
      [device.system_id, index]
    );

    return res.json({
      success: true,
      parameter: {
        ...saved.rows[0],
        compact_wire_string: encodeParamString(saved.rows[0]),
      },
    });
  } catch (err) {
    console.error('[MANAGE] Error saving parameter:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/manage/devices/:systemId/parameters/:paramIndex
 * Delete a single parameter
 */
router.delete('/devices/:systemId/parameters/:paramIndex', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const index = parseInt(req.params.paramIndex, 10);
    await pool.query(
      'DELETE FROM device_parameters WHERE system_id = $1 AND param_index = $2',
      [device.system_id, index]
    );

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM device_parameters WHERE system_id = $1',
      [device.system_id]
    );
    await pool.query('UPDATE devices SET no_of_parameters = $1 WHERE system_id = $2', [
      countRes.rows[0].cnt,
      device.system_id,
    ]);

    return res.json({ success: true, remaining: countRes.rows[0].cnt });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── 3. Relay Modules Management ────────────────────────────────────

/**
 * GET /api/manage/devices/:systemId/relays
 * List configured relay modules for a device
 */
router.get('/devices/:systemId/relays', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const result = await pool.query(
      `SELECT * FROM relay_modules
       WHERE system_id = $1
       ORDER BY slave_id ASC`,
      [device.system_id]
    );

    return res.json({
      system_id: device.system_id,
      config_system_id: reverseHexBytes(device.system_id),
      modules: result.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manage/devices/:systemId/relays
 * Save/replace relay modules list (0 to 16 modules)
 */
router.post('/devices/:systemId/relays', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { modules } = req.body;
    if (!Array.isArray(modules)) {
      return res.status(400).json({ error: 'Modules must be an array' });
    }

    if (modules.length > 16) {
      return res.status(400).json({ error: 'Firmware limit: maximum 16 relay modules' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM relay_modules WHERE system_id = $1', [device.system_id]);

      const seenSlaves = new Set();
      for (const m of modules) {
        const slaveId = parseInt(m.slaveId ?? m.slave_id, 10);
        const channels = parseInt(m.channels ?? 8, 10);
        const coilStart = parseInt(m.coilStart ?? m.coil_start ?? 0, 10);

        if (isNaN(slaveId) || slaveId < 1 || slaveId > 247) {
          throw new Error(`Invalid Slave ID ${slaveId}: must be 1 to 247`);
        }
        if (seenSlaves.has(slaveId)) {
          throw new Error(`Duplicate Slave ID ${slaveId} specified in relay modules`);
        }
        seenSlaves.add(slaveId);

        await client.query(
          `INSERT INTO relay_modules (system_id, slave_id, channels, coil_start)
           VALUES ($1, $2, $3, $4)`,
          [device.system_id, slaveId, channels, coilStart]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const saved = await pool.query(
      'SELECT * FROM relay_modules WHERE system_id = $1 ORDER BY slave_id ASC',
      [device.system_id]
    );

    return res.json({ success: true, modules: saved.rows });
  } catch (err) {
    console.error('[MANAGE] Error saving relay modules:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── 4. Telemetry Inspection ────────────────────────────────────────

/**
 * GET /api/manage/devices/:systemId/telemetry
 * Get latest telemetry records and their decoded sensor values
 */
router.get('/devices/:systemId/telemetry', async (req, res) => {
  try {
    const device = await findDeviceByAnyId(req.params.systemId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const limit = parseInt(req.query.limit || '20', 10);

    const recordsRes = await pool.query(
      `SELECT * FROM telemetry_records
       WHERE system_id = $1
       ORDER BY device_timestamp DESC, id DESC
       LIMIT $2`,
      [device.system_id, limit]
    );

    if (recordsRes.rows.length === 0) {
      return res.json({ records: [] });
    }

    const ids = recordsRes.rows.map((r) => r.id);
    const valuesRes = await pool.query(
      `SELECT tv.*, dp.param_name
       FROM telemetry_values tv
       LEFT JOIN device_parameters dp
         ON dp.system_id = $1 AND dp.param_index = tv.param_index
       WHERE tv.telemetry_id = ANY($2::bigint[])
       ORDER BY tv.telemetry_id DESC, tv.param_index ASC`,
      [device.system_id, ids]
    );

    // Group values by telemetry_id
    const valuesByRecord = new Map();
    for (const v of valuesRes.rows) {
      if (!valuesByRecord.has(v.telemetry_id)) {
        valuesByRecord.set(v.telemetry_id, []);
      }
      valuesByRecord.get(v.telemetry_id).push(v);
    }

    const records = recordsRes.rows.map((r) => ({
      ...r,
      values: valuesByRecord.get(r.id) || [],
    }));

    return res.json({ records });
  } catch (err) {
    console.error('[MANAGE] Error getting telemetry:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── 5. Modbus Helper Tool ──────────────────────────────────────────

/**
 * POST /api/manage/modbus/crc
 * Calculate Modbus RTU CRC16 and assemble frame
 */
router.post('/modbus/crc', (req, res) => {
  try {
    const { slaveId, functionCode, startRegister, count, hex } = req.body;

    if (hex) {
      const cleaned = hex.trim().replace(/\s+/g, '').toUpperCase();
      let payloadHex = cleaned;
      let calculatedCrc;
      let validation = { valid: true };

      if (cleaned.length >= 8) {
        validation = validateModbusRtuRequest(cleaned);
        if (validation.valid) {
          payloadHex = cleaned.substring(0, cleaned.length - 4);
          calculatedCrc = calculateModbusCRC(payloadHex).hexLE;
        } else {
          calculatedCrc = calculateModbusCRC(cleaned).hexLE;
        }
      } else {
        calculatedCrc = calculateModbusCRC(cleaned).hexLE;
      }

      return res.json({
        inputHex: cleaned,
        payloadHex,
        calculatedCrc,
        ...validation,
      });
    }

    const slave = parseInt(slaveId, 10);
    const fc = parseInt(functionCode, 10);
    const reg = parseInt(startRegister, 10);
    const cnt = parseInt(count, 10);

    if (isNaN(slave) || isNaN(fc) || isNaN(reg) || isNaN(cnt)) {
      return res
        .status(400)
        .json({ error: 'slaveId, functionCode, startRegister, and count are required' });
    }

    const frame = buildModbusRtuRequest(slave, fc, reg, cnt);
    return res.json({
      slaveId: slave,
      functionCode: fc,
      startRegister: reg,
      count: cnt,
      ...frame,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
