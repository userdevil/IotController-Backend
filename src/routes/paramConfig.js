import { Router } from 'express';
import { DeviceParameter } from '../db/models/index.js';
import { reverseHexBytes, encodeParamString } from '../utils/hexCodec.js';

const router = Router();

/**
 * POST /api/param-config
 *
 * DAQ Parameter configuration (Phase 3).
 * JSON body: { "TYPE": "PARA_CONFIG", "SYS_ID": "00000D5E", "FROM": "000", "TO": "009" }
 *
 * Returns up to 10 compact parameter strings per batch.
 * Each string has a 30-char fixed header + modbus hex + "#" + name (max 9 chars).
 */
router.post('/', async (req, res) => {
  try {
    const reqType = req.body?.TYPE || req.body?.type;
    const configSysId = req.body?.SYS_ID || req.body?.SYSTEM_ID;
    const fromIdx = parseInt(req.body?.FROM || '0', 10);
    const toIdx = parseInt(req.body?.TO || '0', 10);

    if (reqType !== 'PARA_CONFIG') {
      return res.status(400).json({ status: 'error', msg: 'Invalid TYPE' });
    }

    if (!configSysId) {
      return res.status(400).json({ status: 'error', msg: 'Missing SYS_ID' });
    }

    // Convert config-order → wire-order for DB lookup
    const wireId = reverseHexBytes(String(configSysId).trim().toUpperCase());

    const params = await DeviceParameter.find({
      system_id: wireId,
      param_index: { $gte: fromIdx, $lte: toIdx },
    })
      .sort({ param_index: 1 })
      .lean();

    // Build compact parameter strings, each wrapped in a one-element array
    const paraArray = params.map((row) => [encodeParamString(row)]);

    const actualTo = params.length > 0
      ? params[params.length - 1].param_index
      : toIdx;

    console.log(
      `[PARAM_CONFIG] Device: ${configSysId}, FROM=${fromIdx}, TO=${actualTo}, Count=${paraArray.length}`
    );

    return res.json({
      TYPE: 'PARA_CONFIG',
      FROM: String(fromIdx).padStart(3, '0'),
      TO: String(actualTo).padStart(3, '0'),
      PARA: paraArray,
    });
  } catch (err) {
    console.error('[PARAM_CONFIG] Error:', err.message);
    return res.status(500).json({ status: 'error', msg: 'Internal Server Error' });
  }
});

export default router;
