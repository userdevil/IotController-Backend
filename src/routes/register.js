import { Router } from 'express';
import pool from '../db/pool.js';
import { intToHex8, intToWireHex } from '../utils/hexCodec.js';

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
    const imei = req.body.IMIENumber;
    if (!imei) {
      return res.status(400).type('text').send('Bad Request: missing IMIENumber');
    }

    // Check if already registered
    const existing = await pool.query(
      'SELECT system_id FROM devices WHERE imei = $1',
      [imei]
    );

    if (existing.rows.length > 0) {
      const sysId = existing.rows[0].system_id;
      console.log(`[REGISTER] Existing device: IMEI=${imei}, SystemID=${sysId}`);
      return res.type('text').send(`$SysID=${sysId}#`);
    }

    // Generate new SYSTEM_ID from auto-increment sequence
    const seqResult = await pool.query("SELECT nextval('device_id_seq') AS id");
    const deviceInt = parseInt(seqResult.rows[0].id);
    const systemId = intToWireHex(deviceInt);

    // Insert new device with default config
    await pool.query(
      `INSERT INTO devices (system_id, imei, server_add, server_port, server_path)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        systemId,
        imei,
        process.env.DEFAULT_SERVER_ADD || 'localhost',
        process.env.DEFAULT_SERVER_PORT || '8080',
        process.env.DEFAULT_SERVER_PATH || '/',
      ]
    );

    console.log(`[REGISTER] New device: IMEI=${imei}, SystemID=${systemId} (int=${deviceInt})`);
    return res.type('text').send(`$SysID=${systemId}#`);
  } catch (err) {
    console.error('[REGISTER] Error:', err.message);
    return res.status(500).type('text').send('Internal Server Error');
  }
});

export default router;
