import { Router } from 'express';
import pool from '../db/pool.js';
import { decodeDataPayload } from '../utils/hexCodec.js';
import { buildIstResponse } from '../utils/timeSync.js';

const router = Router();

/**
 * POST /api/data
 *
 * Telemetry / Sensor Data Ingestion (Phase 4).
 * Body: application/x-www-form-urlencoded
 * Parameter: DATA000=<UPPERCASE_HEX_PAYLOAD>
 *
 * Decodes 26-byte wire header + N IEEE-754 Little-Endian float parameters.
 * Inserts records into PostgreSQL in a transaction.
 * Responds with 200 OK text containing the IST RTC sync token:
 * "Packet Inserted >$IST=YYYYMMDDHHmmss#"
 */
router.post('/', async (req, res) => {
  const dataPayload = req.body?.DATA000;

  if (!dataPayload || typeof dataPayload !== 'string') {
    return res.status(400).type('text').send('Bad Request: missing DATA000');
  }

  let decoded;
  try {
    decoded = decodeDataPayload(dataPayload.trim());
  } catch (err) {
    console.error('[DATA_TRANSFER] Decode error:', err.message);
    return res.status(400).type('text').send(`Bad Request: ${err.message}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert header into telemetry_records
    const recordResult = await client.query(
      `INSERT INTO telemetry_records (
        system_id,
        device_timestamp,
        write_counter,
        acquisition_counter,
        signal_strength,
        relay1_status,
        relay2_status,
        relay3_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        decoded.systemId,
        decoded.timestamp,
        decoded.writeCounter,
        decoded.acquisitionCounter,
        decoded.signalStrength,
        decoded.relays[0],
        decoded.relays[1],
        decoded.relays[2],
      ]
    );

    const telemetryId = recordResult.rows[0].id;

    // 2. Insert telemetry values
    if (decoded.values && decoded.values.length > 0) {
      // Build batch insert query
      const valueRows = [];
      const queryParams = [];
      let paramIdx = 1;

      for (const item of decoded.values) {
        valueRows.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        queryParams.push(
          telemetryId,
          item.index,
          item.value,
          item.status === 'TIMEOUT',
          item.status === 'COMM_ERROR'
        );
      }

      const insertValuesSql = `
        INSERT INTO telemetry_values (telemetry_id, param_index, value, is_timeout, is_error)
        VALUES ${valueRows.join(', ')}
      `;

      await client.query(insertValuesSql, queryParams);
    }

    // 3. Update device last_seen_at
    await client.query(
      'UPDATE devices SET last_seen_at = NOW() WHERE system_id = $1',
      [decoded.systemId]
    );

    await client.query('COMMIT');

    console.log(
      `[DATA_TRANSFER] Device: ${decoded.systemId}, Record ID: ${telemetryId}, Params: ${decoded.values.length}, Timestamp: ${decoded.timestamp.toISOString()}`
    );

    // 4. Return Indian Standard Time clock-sync response required by MCP7940 RTC
    const ack = buildIstResponse();
    return res.status(200).type('text').send(ack);
  } catch (dbErr) {
    await client.query('ROLLBACK');
    console.error('[DATA_TRANSFER] Database transaction error:', dbErr);
    return res.status(500).type('text').send('Internal Server Error');
  } finally {
    client.release();
  }
});

export default router;
