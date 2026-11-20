import { Router } from 'express';
import { Device, RelayModule } from '../db/models/index.js';
import { reverseHexBytes } from '../utils/hexCodec.js';

const router = Router();

/**
 * POST /api/relay-config
 *
 * Relay Module Configuration & MQTT Settings (Phase 5).
 * JSON body: { "TYPE": "RELAY_MODULE_CONFIG", "SYSTEM_ID": "00000D5E" }
 *
 * Returns MQTT broker connection information and configured Modbus RTU relay modules.
 */
router.post('/', async (req, res) => {
  try {
    const reqType = req.body?.TYPE || req.body?.type;
    const configSysId = req.body?.SYSTEM_ID || req.body?.SYS_ID;

    if (reqType !== 'RELAY_MODULE_CONFIG') {
      return res.status(400).json({ status: 'error', msg: 'Invalid TYPE' });
    }

    if (!configSysId) {
      return res.status(400).json({ status: 'error', msg: 'Missing SYSTEM_ID' });
    }

    // Convert config-order "00000D5E" -> wire-order "5E0D0000" for DB lookup
    const wireId = reverseHexBytes(String(configSysId).trim().toUpperCase());

    const device = await Device.findOne({ system_id: wireId }).lean();

    if (!device) {
      return res.status(404).json({ status: 'error', msg: 'Device not found' });
    }

    // Fetch configured relay modules for this device (0 to 16 modules)
    const modulesDocs = await RelayModule.find({ system_id: wireId })
      .sort({ slave_id: 1 })
      .lean();

    const modules = modulesDocs.map((row) => ({
      slaveId: row.slave_id,
      channels: row.channels || 8,
      coilStart: row.coil_start || 0,
    }));

    console.log(
      `[RELAY_CONFIG] Device: ${configSysId}, Modules: ${modules.length}`
    );

    return res.json({
      TYPE: 'RELAY_MODULE_CONFIG',
      SYSTEM_ID: configSysId.toUpperCase(),
      MQTT_BROKER: device.mqtt_broker || 'broker.example.net',
      MQTT_PORT: device.mqtt_port || 1883,
      MQTT_CLIENT_ID: device.mqtt_client_id || `device-${configSysId.toUpperCase()}`,
      MQTT_USERNAME: device.mqtt_username || 'device-user',
      MQTT_PASSWORD: device.mqtt_password || '',
      MQTT_COMMAND_TOPIC:
        device.mqtt_command_topic || `devices/${configSysId.toUpperCase()}/relay/set`,
      MQTT_STATUS_TOPIC:
        device.mqtt_status_topic || `devices/${configSysId.toUpperCase()}/relay/status`,
      MODULES: modules,
    });
  } catch (err) {
    console.error('[RELAY_CONFIG] Error:', err.message);
    return res.status(500).json({ status: 'error', msg: 'Internal Server Error' });
  }
});

export default router;
