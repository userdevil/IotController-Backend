import { Router } from 'express';
import { TelemetryRecord, Device } from '../db/models/index.js';
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
 * Inserts document into MongoDB TelemetryRecord.
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

  try {
    const formattedValues = (decoded.values || []).map((item) => ({
      param_index: item.index,
      value: item.value,
      is_timeout: item.status === 'TIMEOUT',
      is_error: item.status === 'COMM_ERROR',
    }));

    // 1. Create TelemetryRecord
    const record = await TelemetryRecord.create({
      system_id: decoded.systemId,
      device_timestamp: decoded.timestamp,
      write_counter: decoded.writeCounter,
      acquisition_counter: decoded.acquisitionCounter,
      signal_strength: decoded.signalStrength,
      relay1_status: Boolean(decoded.relays[0]),
      relay2_status: Boolean(decoded.relays[1]),
      relay3_status: Boolean(decoded.relays[2]),
      values: formattedValues,
    });

    // 2. Update device last_seen_at
    await Device.updateOne(
      { system_id: decoded.systemId },
      { $set: { last_seen_at: new Date() } }
    );

    console.log(
      `[DATA_TRANSFER] Device: ${decoded.systemId}, Record ID: ${record._id}, Params: ${formattedValues.length}, Timestamp: ${decoded.timestamp.toISOString()}`
    );

    // 3. Return Indian Standard Time clock-sync response required by MCP7940 RTC
    const ack = buildIstResponse();
    return res.status(200).type('text').send(ack);
  } catch (dbErr) {
    console.error('[DATA_TRANSFER] Database error:', dbErr);
    return res.status(500).type('text').send('Internal Server Error');
  }
});

export default router;
