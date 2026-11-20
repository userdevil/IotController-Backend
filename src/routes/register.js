import { Router } from 'express';
import { Device, Counter } from '../db/models/index.js';
import { intToWireHex } from '../utils/hexCodec.js';

const router = Router();

/**
 * POST /api/register
 *
 * Device registration (Phase 1).
 * Form field: IMIENumber=<15-digit IMEI>
 * Response:   plain text "$SysID=<8-char wire-order hex>#"
 */
router.post('/', async (req, res) => {
  try {
    const imei = req.body?.IMIENumber;
    if (!imei) {
      return res.status(400).type('text').send('Bad Request: missing IMIENumber');
    }

    const cleanImei = String(imei).trim();

    // Check if already registered
    const existing = await Device.findOne({ imei: cleanImei }).lean();

    if (existing) {
      const sysId = existing.system_id;
      console.log(`[REGISTER] Existing device: IMEI=${cleanImei}, SystemID=${sysId}`);
      return res.type('text').send(`$SysID=${sysId}#`);
    }

    // Generate new SYSTEM_ID from auto-increment sequence
    const deviceInt = await Counter.getNextSequence('device_id');
    const systemId = intToWireHex(deviceInt);

    // Insert new device with default config
    await Device.create({
      system_id: systemId,
      imei: cleanImei,
      name: `Device-${systemId}`,
      server_add: process.env.DEFAULT_SERVER_ADD || 'localhost',
      server_port: process.env.DEFAULT_SERVER_PORT || '8080',
      server_path: process.env.DEFAULT_SERVER_PATH || '/',
    });

    console.log(`[REGISTER] New device: IMEI=${cleanImei}, SystemID=${systemId} (int=${deviceInt})`);
    return res.type('text').send(`$SysID=${systemId}#`);
  } catch (err) {
    console.error('[REGISTER] Error:', err.message);
    return res.status(500).type('text').send('Internal Server Error');
  }
});

export default router;
