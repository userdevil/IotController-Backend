import { Router } from 'express';
import { Device, DeviceParameter } from '../db/models/index.js';
import { reverseHexBytes } from '../utils/hexCodec.js';

const router = Router();

/**
 * POST /api/system-config
 *
 * System configuration (Phase 2).
 * JSON body: { "TYPE": "SERVER_DETAILS", "SYSTEM_ID": "00000D5E" }
 *
 * Returns the device's operational config: server endpoints, parameter count,
 * acquisition/transmission intervals. The SYSTEM_ID in the request uses
 * config-order (big-endian) hex; we reverse it to wire-order for DB lookup.
 */
router.post('/', async (req, res) => {
  try {
    const reqType = req.body?.TYPE || req.body?.type;
    const configSysId = req.body?.SYSTEM_ID || req.body?.SYS_ID;

    if (reqType !== 'SERVER_DETAILS') {
      return res.status(400).json({ status: 'error', msg: 'Invalid TYPE' });
    }

    if (!configSysId) {
      return res.status(400).json({ status: 'error', msg: 'Missing SYSTEM_ID' });
    }

    // Convert config-order "00000D5E" → wire-order "5E0D0000" for DB lookup
    const wireId = reverseHexBytes(String(configSysId).trim().toUpperCase());

    const device = await Device.findOne({ system_id: wireId }).lean();

    if (!device) {
      return res.status(404).json({ status: 'error', msg: 'Device not found' });
    }

    // Count configured parameters
    const paramCount = await DeviceParameter.countDocuments({ system_id: wireId });
    const finalParamCount = paramCount || device.no_of_parameters || 0;

    // Format fields per firmware expectations
    const paramCountHex = finalParamCount.toString(16).toUpperCase().padStart(2, '0');
    const acqHex = (device.acq_interval_min || 1).toString(16).toUpperCase().padStart(8, '0');
    const transHex = (device.trans_interval_min || 1).toString(16).toUpperCase().padStart(8, '0');

    console.log(`[SYSTEM_CONFIG] Device: ${configSysId}, Params: ${finalParamCount}`);

    return res.json({
      SYSTEM_ID: configSysId.toUpperCase(),
      SERVER_ADD: device.server_add || process.env.DEFAULT_SERVER_ADD || 'localhost',
      SERVER_PORT: device.server_port || process.env.DEFAULT_SERVER_PORT || '8080',
      SERVER_PATH: device.server_path || '/',
      SER_APP_DATA: device.data_app || 'api/data',
      NO_OF_PARAMETERS: paramCountHex,
      DATA_ACQ_MINUTES: acqHex,
      DATA_TRANS_MINUTES: transHex,
    });
  } catch (err) {
    console.error('[SYSTEM_CONFIG] Error:', err.message);
    return res.status(500).json({ status: 'error', msg: 'Internal Server Error' });
  }
});

export default router;
