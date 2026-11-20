import { Router } from 'express';
import { Device, DeviceParameter, RelayModule, TelemetryRecord, Counter } from '../db/models/index.js';
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
  let doc = await Device.findOne({ system_id: clean }).lean();
  if (doc) return doc;

  // Try reversed (config-order)
  if (clean.length === 8) {
    const reversed = reverseHexBytes(clean);
    doc = await Device.findOne({ system_id: reversed }).lean();
    if (doc) return doc;
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
    const deviceDocs = await Device.find().sort({ created_at: -1 }).lean();

    const devices = await Promise.all(
      deviceDocs.map(async (d) => {
        const [paramCount, relayCount] = await Promise.all([
          DeviceParameter.countDocuments({ system_id: d.system_id }),
          RelayModule.countDocuments({ system_id: d.system_id }),
        ]);

        return {
          ...d,
          param_count: paramCount,
          relay_count: relayCount,
          config_system_id: reverseHexBytes(d.system_id),
        };
      })
    );

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

    const cleanImei = String(imei).trim();
    let wireId = system_id ? system_id.trim().toUpperCase() : null;

    // Check if device exists by IMEI or system_id
    let existing = null;
    if (wireId) {
      existing = await findDeviceByAnyId(wireId);
    }
    if (!existing) {
      existing = await Device.findOne({ imei: cleanImei }).lean();
    }

    let saved;
    if (existing) {
      wireId = existing.system_id;
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (server_add !== undefined) updateData.server_add = server_add;
      if (server_port !== undefined) updateData.server_port = server_port;
      if (server_path !== undefined) updateData.server_path = server_path;
      if (acq_interval_min !== undefined) updateData.acq_interval_min = acq_interval_min;
      if (trans_interval_min !== undefined) updateData.trans_interval_min = trans_interval_min;
      if (mqtt_broker !== undefined) updateData.mqtt_broker = mqtt_broker;
      if (mqtt_port !== undefined) updateData.mqtt_port = mqtt_port;
      if (mqtt_client_id !== undefined) updateData.mqtt_client_id = mqtt_client_id;
      if (mqtt_username !== undefined) updateData.mqtt_username = mqtt_username;
      if (mqtt_password !== undefined) updateData.mqtt_password = mqtt_password;
      if (mqtt_command_topic !== undefined) updateData.mqtt_command_topic = mqtt_command_topic;
      if (mqtt_status_topic !== undefined) updateData.mqtt_status_topic = mqtt_status_topic;

      saved = await Device.findOneAndUpdate(
        { system_id: wireId },
        { $set: updateData },
        { new: true }
      ).lean();
    } else {
      // Create new device: generate system_id if not provided
      if (!wireId) {
        const deviceInt = await Counter.getNextSequence('device_id');
        wireId = intToWireHex(deviceInt);
      }

      saved = await Device.create({
        system_id: wireId,
        imei: cleanImei,
        name: name || `Device-${wireId}`,
        server_add: server_add || process.env.DEFAULT_SERVER_ADD || 'localhost',
        server_port: server_port || process.env.DEFAULT_SERVER_PORT || '8080',
        server_path: server_path || process.env.DEFAULT_SERVER_PATH || '/',
        acq_interval_min: acq_interval_min || 1,
        trans_interval_min: trans_interval_min || 1,
        mqtt_broker: mqtt_broker || 'broker.example.net',
        mqtt_port: mqtt_port || 1883,
        mqtt_client_id: mqtt_client_id || `device-${reverseHexBytes(wireId)}`,
        mqtt_username: mqtt_username || '',
        mqtt_password: mqtt_password || '',
        mqtt_command_topic: mqtt_command_topic || `devices/${reverseHexBytes(wireId)}/relay/set`,
        mqtt_status_topic: mqtt_status_topic || `devices/${reverseHexBytes(wireId)}/relay/status`,
      });
      saved = saved.toObject();
    }

    return res.json({
      success: true,
      device: {
        ...saved,
        config_system_id: reverseHexBytes(saved.system_id),
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

    const params = await DeviceParameter.find({ system_id: device.system_id })
      .sort({ param_index: 1 })
      .lean();

    // Compute preview compact string for each parameter
    const parameters = params.map((row) => ({
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

    // Upsert into DeviceParameter
    const saved = await DeviceParameter.findOneAndUpdate(
      { system_id: device.system_id, param_index: index },
      {
        $set: {
          param_name: trimmedName,
          source_type: source_type ?? 12,
          para_type: para_type ?? 0,
          rs485_mode: rs485_mode ?? 0,
          rs485_data_type: rs485_data_type ?? 1,
          baud_rate: baud_rate ?? 0,
          data_bits: data_bits ?? 0,
          parity: parity ?? 0,
          stop_bits: stop_bits ?? 0,
          timeout_ms: timeout_ms ?? 3000,
          mul_factor: mul_factor ?? 1.0,
          add_factor: add_factor ?? 0.0,
          modbus_req_hex: cleanedModbusHex,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // Update count in devices
    const totalCount = await DeviceParameter.countDocuments({ system_id: device.system_id });
    await Device.updateOne(
      { system_id: device.system_id },
      { $set: { no_of_parameters: totalCount } }
    );

    return res.json({
      success: true,
      parameter: {
        ...saved,
        compact_wire_string: encodeParamString(saved),
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
    await DeviceParameter.deleteOne({
      system_id: device.system_id,
      param_index: index,
    });

    const totalCount = await DeviceParameter.countDocuments({ system_id: device.system_id });
    await Device.updateOne(
      { system_id: device.system_id },
      { $set: { no_of_parameters: totalCount } }
    );

    return res.json({ success: true, remaining: totalCount });
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

    const modules = await RelayModule.find({ system_id: device.system_id })
      .sort({ slave_id: 1 })
      .lean();

    return res.json({
      system_id: device.system_id,
      config_system_id: reverseHexBytes(device.system_id),
      modules,
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

    const seenSlaves = new Set();
    const toInsert = [];
    for (const m of modules) {
      const slaveId = parseInt(m.slaveId ?? m.slave_id, 10);
      const channels = parseInt(m.channels ?? 8, 10);
      const coilStart = parseInt(m.coilStart ?? m.coil_start ?? 0, 10);

      if (isNaN(slaveId) || slaveId < 1 || slaveId > 247) {
        return res.status(400).json({ error: `Invalid Slave ID ${slaveId}: must be 1 to 247` });
      }
      if (seenSlaves.has(slaveId)) {
        return res.status(400).json({ error: `Duplicate Slave ID ${slaveId} specified in relay modules` });
      }
      seenSlaves.add(slaveId);

      toInsert.push({
        system_id: device.system_id,
        slave_id: slaveId,
        channels,
        coil_start: coilStart,
      });
    }

    // Replace relay modules for this device
    await RelayModule.deleteMany({ system_id: device.system_id });
    if (toInsert.length > 0) {
      await RelayModule.insertMany(toInsert);
    }

    const saved = await RelayModule.find({ system_id: device.system_id })
      .sort({ slave_id: 1 })
      .lean();

    return res.json({ success: true, modules: saved });
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

    const recordDocs = await TelemetryRecord.find({ system_id: device.system_id })
      .sort({ device_timestamp: -1, _id: -1 })
      .limit(limit)
      .lean();

    if (recordDocs.length === 0) {
      return res.json({ records: [] });
    }

    // Build map of param_index -> param_name
    const paramDocs = await DeviceParameter.find({ system_id: device.system_id }).lean();
    const paramNameMap = new Map();
    for (const p of paramDocs) {
      paramNameMap.set(p.param_index, p.param_name);
    }

    const records = recordDocs.map((r) => ({
      id: r._id,
      system_id: r.system_id,
      device_timestamp: r.device_timestamp,
      write_counter: r.write_counter,
      acquisition_counter: r.acquisition_counter,
      signal_strength: r.signal_strength,
      relay1_status: r.relay1_status,
      relay2_status: r.relay2_status,
      relay3_status: r.relay3_status,
      values: (r.values || []).map((v) => ({
        ...v,
        param_name: paramNameMap.get(v.param_index) || null,
      })),
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
