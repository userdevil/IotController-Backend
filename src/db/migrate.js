import pool from './pool.js';

const migration = `
  -- Auto-increment sequence for generating integer device IDs
  CREATE SEQUENCE IF NOT EXISTS device_id_seq START 1;

  -- 1. Devices
  CREATE TABLE IF NOT EXISTS devices (
    system_id         VARCHAR(8) PRIMARY KEY,
    imei              VARCHAR(15) UNIQUE NOT NULL,
    name              VARCHAR(100),
    server_add        VARCHAR(50)  DEFAULT 'localhost',
    server_port       VARCHAR(6)   DEFAULT '8080',
    server_path       VARCHAR(50)  DEFAULT '/',
    registration_app  VARCHAR(50)  DEFAULT 'api/register',
    system_config_app VARCHAR(50)  DEFAULT 'api/system-config',
    param_config_app  VARCHAR(50)  DEFAULT 'api/param-config',
    data_app          VARCHAR(50)  DEFAULT 'api/data',
    relay_config_app  VARCHAR(50)  DEFAULT 'api/relay-config',
    no_of_parameters  INT          DEFAULT 0,
    acq_interval_min  INT          DEFAULT 1,
    trans_interval_min INT         DEFAULT 1,
    mqtt_broker       VARCHAR(100),
    mqtt_port         INT          DEFAULT 1883,
    mqtt_client_id    VARCHAR(100),
    mqtt_username     VARCHAR(100),
    mqtt_password     VARCHAR(100),
    mqtt_command_topic VARCHAR(200),
    mqtt_status_topic  VARCHAR(200),
    last_seen_at      TIMESTAMP WITH TIME ZONE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- 2. DAQ Parameter Definitions
  CREATE TABLE IF NOT EXISTS device_parameters (
    id              SERIAL PRIMARY KEY,
    system_id       VARCHAR(8) REFERENCES devices(system_id) ON DELETE CASCADE,
    param_index     INT NOT NULL,
    param_name      VARCHAR(9) NOT NULL,
    source_type     INT NOT NULL DEFAULT 0,
    para_type       INT DEFAULT 0,
    rs485_mode      INT DEFAULT 0,
    rs485_data_type INT DEFAULT 0,
    baud_rate       INT DEFAULT 0,
    data_bits       INT DEFAULT 0,
    parity          INT DEFAULT 0,
    stop_bits       INT DEFAULT 0,
    timeout_ms      INT DEFAULT 3000,
    mul_factor      REAL DEFAULT 1.0,
    add_factor      REAL DEFAULT 0.0,
    modbus_req_hex  VARCHAR(29),
    UNIQUE(system_id, param_index)
  );

  -- 3. Telemetry Records (time-series header)
  CREATE TABLE IF NOT EXISTS telemetry_records (
    id                   BIGSERIAL PRIMARY KEY,
    system_id            VARCHAR(8) REFERENCES devices(system_id),
    device_timestamp     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    write_counter        BIGINT NOT NULL,
    acquisition_counter  BIGINT NOT NULL,
    signal_strength      INT,
    relay1_status        BOOLEAN,
    relay2_status        BOOLEAN,
    relay3_status        BOOLEAN,
    received_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- 4. Telemetry Parameter Values
  CREATE TABLE IF NOT EXISTS telemetry_values (
    telemetry_id BIGINT REFERENCES telemetry_records(id) ON DELETE CASCADE,
    param_index  INT NOT NULL,
    value        DOUBLE PRECISION,
    is_timeout   BOOLEAN DEFAULT FALSE,
    is_error     BOOLEAN DEFAULT FALSE,
    PRIMARY KEY(telemetry_id, param_index)
  );

  -- 5. Relay Modules (per-device, 0–16 modules)
  CREATE TABLE IF NOT EXISTS relay_modules (
    id         SERIAL PRIMARY KEY,
    system_id  VARCHAR(8) REFERENCES devices(system_id) ON DELETE CASCADE,
    slave_id   INT NOT NULL,
    channels   INT NOT NULL DEFAULT 8,
    coil_start INT NOT NULL DEFAULT 0,
    UNIQUE(system_id, slave_id)
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_telemetry_sys_time
    ON telemetry_records (system_id, device_timestamp DESC);
`;

export async function runMigration() {
  try {
    await pool.query(migration);
    console.log('[DB] Migration completed successfully');
  } catch (err) {
    console.error('[DB] Migration failed:', err.message);
    throw err;
  }
}

// Allow standalone execution: npm run db:migrate
if (process.argv[1]?.replace(/\\/g, '/').includes('db/migrate')) {
  const { config } = await import('dotenv');
  config();
  try {
    await runMigration();
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
