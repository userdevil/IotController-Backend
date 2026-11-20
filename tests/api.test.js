import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import app from '../src/app.js';
import pool from '../src/db/pool.js';

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
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
