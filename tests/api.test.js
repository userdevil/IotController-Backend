import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import app from '../src/app.js';
import { connectDB, closeDB } from '../src/db/connection.js';
import { Device, DeviceParameter, RelayModule, TelemetryRecord } from '../src/db/models/index.js';
import { reverseHexBytes } from '../src/utils/hexCodec.js';

let server;
let baseUrl;

test.before(async () => {
  // Connect to MongoDB
  await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/iot_controller');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDB();
});

test('GET /health returns 200 ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
});

test('POST /api/register - missing IMIENumber returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes('missing IMIENumber'));
});

test('POST /api/register - registers new device and returns consistent $SysID', async () => {
  const testImei = `TEST_${Date.now()}`;
  const res1 = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `IMIENumber=${testImei}`,
  });
  assert.equal(res1.status, 200);
  const text1 = await res1.text();
  assert.match(text1, /^\$SysID=[0-9A-F]{8}#$/);

  // Second register call for same IMEI should return the exact same SysID
  const res2 = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `IMIENumber=${testImei}`,
  });
  assert.equal(res2.status, 200);
  const text2 = await res2.text();
  assert.equal(text2, text1);

  // Clean up
  const sysId = text1.slice(7, 15);
  await Device.deleteOne({ system_id: sysId });
});

test('POST /api/system-config - invalid TYPE returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/system-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TYPE: 'INVALID', SYSTEM_ID: '00000D5E' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.msg, 'Invalid TYPE');
});

test('POST /api/system-config - returns device operational configuration', async () => {
  // Create a device with known ID: wire 5E0D0000 -> config 00000D5E
  const wireId = '5E0D0000';
  const configId = '00000D5E';
  await Device.deleteMany({ system_id: wireId });
  await Device.create({
    system_id: wireId,
    imei: '861234567890123',
    name: 'Test Device',
    server_add: 'config.example.com',
    server_port: '8080',
    server_path: '/',
    acq_interval_min: 5,
    trans_interval_min: 10,
  });

  const res = await fetch(`${baseUrl}/api/system-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TYPE: 'SERVER_DETAILS', SYSTEM_ID: configId }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.SYSTEM_ID, configId);
  assert.equal(data.SERVER_ADD, 'config.example.com');
  assert.equal(data.SERVER_PORT, '8080');
  assert.equal(data.DATA_ACQ_MINUTES, '00000005');
  assert.equal(data.DATA_TRANS_MINUTES, '0000000A');

  // Clean up
  await Device.deleteMany({ system_id: wireId });
});

test('POST /api/param-config - invalid TYPE returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/param-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TYPE: 'INVALID', SYS_ID: '00000D5E' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/relay-config - invalid TYPE returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/relay-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TYPE: 'INVALID', SYSTEM_ID: '00000D5E' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/data - missing DATA000 returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'FOO=BAR',
  });
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes('missing DATA000'));
});

test('POST /api/data - invalid payload length returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'DATA000=0100',
  });
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes('Payload too short'));
});

test('POST /api/data - successfully decodes and stores telemetry record', async () => {
  const wireSysId = '5E0D0000';
  await Device.deleteMany({ system_id: wireSysId });
  await TelemetryRecord.deleteMany({ system_id: wireSysId });

  await Device.create({
    system_id: wireSysId,
    imei: '861234567890999',
    name: 'Telemetry Test Device',
  });

  // Test vector from section 5.3 of guide:
  // Write Cnt = 1, SysID = 5E0D0000, Timestamp = 19/11/26 15:30:00, CSQ = 28, Relays, Params = 2
  const payloadHex =
    '010000005E0D0000191126153000280100000100000002000000E17A48420000C842';

  const res = await fetch(`${baseUrl}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `DATA000=${payloadHex}`,
  });

  assert.equal(res.status, 200);
  const ackText = await res.text();
  assert.match(ackText, /^Packet Inserted >\$IST=\d{14}#$/);

  // Check saved in MongoDB
  const saved = await TelemetryRecord.findOne({ system_id: wireSysId }).lean();
  assert.ok(saved);
  assert.equal(saved.write_counter, 1);
  assert.equal(saved.acquisition_counter, 1);
  assert.equal(saved.signal_strength, 28);
  assert.equal(saved.relay1_status, true);
  assert.equal(saved.values.length, 2);
  assert.ok(Math.abs(saved.values[0].value - 50.12) < 0.01);
  assert.ok(Math.abs(saved.values[1].value - 100.0) < 0.01);

  // Clean up
  await Device.deleteMany({ system_id: wireSysId });
  await TelemetryRecord.deleteMany({ system_id: wireSysId });
});

test('GET / serves the web dashboard index.html', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('IoT Controller Studio'));
  assert.ok(html.includes('Modbus RTU & DAQ Parameter Builder'));
});

test('POST /api/manage/modbus/crc calculates frame and validates CRC', async () => {
  // Test frame building
  const res1 = await fetch(`${baseUrl}/api/manage/modbus/crc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slaveId: 1, functionCode: 3, startRegister: 0, count: 2 }),
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.fullPacketHex, '010300000002C40B');
  assert.equal(data1.crcHex, 'C40B');

  // Test hex validation
  const res2 = await fetch(`${baseUrl}/api/manage/modbus/crc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex: '010300000002C40B' }),
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.valid, true);
  assert.equal(data2.calculatedCrc, 'C40B');
});

test('Management APIs - full lifecycle: create device, add params, relays, and query', async () => {
  const wireSysId = '99000000';
  const configSysId = reverseHexBytes(wireSysId);

  // Clean up
  await Device.deleteMany({ system_id: wireSysId });
  await DeviceParameter.deleteMany({ system_id: wireSysId });
  await RelayModule.deleteMany({ system_id: wireSysId });
  await TelemetryRecord.deleteMany({ system_id: wireSysId });

  // 1. Create Device
  const devRes = await fetch(`${baseUrl}/api/manage/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_id: wireSysId,
      imei: '869999999999999',
      name: 'Lifecycle Test Device',
      acq_interval_min: 2,
      trans_interval_min: 4,
    }),
  });
  assert.equal(devRes.status, 200);
  const devData = await devRes.json();
  assert.equal(devData.success, true);
  assert.equal(devData.device.system_id, wireSysId);
  assert.equal(devData.device.config_system_id, configSysId);

  // 2. List Devices
  const listRes = await fetch(`${baseUrl}/api/manage/devices`);
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  const foundDev = listData.devices.find((d) => d.system_id === wireSysId);
  assert.ok(foundDev);
  assert.equal(foundDev.name, 'Lifecycle Test Device');

  // 3. Add DAQ Parameter
  const paramRes = await fetch(`${baseUrl}/api/manage/devices/${wireSysId}/parameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      param_index: 0,
      param_name: 'Voltage',
      source_type: 12,
      modbus_req_hex: '010300000002C40B',
      mul_factor: 1.0,
      add_factor: 0.0,
      timeout_ms: 3000,
    }),
  });
  assert.equal(paramRes.status, 200);
  const paramData = await paramRes.json();
  assert.equal(paramData.success, true);
  assert.equal(paramData.parameter.param_name, 'Voltage');
  assert.ok(paramData.parameter.compact_wire_string.includes('010300000002C40B'));

  // 4. Test Firmware POST /api/param-config
  const paraConfigRes = await fetch(`${baseUrl}/api/param-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      TYPE: 'PARA_CONFIG',
      SYS_ID: configSysId,
      FROM: '000',
      TO: '009',
    }),
  });
  assert.equal(paraConfigRes.status, 200);
  const paraConfigData = await paraConfigRes.json();
  assert.equal(paraConfigData.PARA.length, 1);
  assert.ok(paraConfigData.PARA[0][0].includes('Voltage'));

  // 5. Add Relay Module
  const relayRes = await fetch(`${baseUrl}/api/manage/devices/${wireSysId}/relays`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modules: [{ slaveId: 1, channels: 8, coilStart: 0 }],
    }),
  });
  assert.equal(relayRes.status, 200);
  const relayData = await relayRes.json();
  assert.equal(relayData.success, true);
  assert.equal(relayData.modules.length, 1);

  // 6. Test Firmware POST /api/relay-config
  const relayConfigRes = await fetch(`${baseUrl}/api/relay-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      TYPE: 'RELAY_MODULE_CONFIG',
      SYSTEM_ID: configSysId,
    }),
  });
  assert.equal(relayConfigRes.status, 200);
  const relayConfigData = await relayConfigRes.json();
  assert.equal(relayConfigData.MODULES.length, 1);
  assert.equal(relayConfigData.MODULES[0].slaveId, 1);

  // 7. Clean up
  await Device.deleteMany({ system_id: wireSysId });
  await DeviceParameter.deleteMany({ system_id: wireSysId });
  await RelayModule.deleteMany({ system_id: wireSysId });
});
