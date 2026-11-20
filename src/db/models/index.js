import mongoose from 'mongoose';

// ─── 1. Counter Schema (for auto-increment device IDs) ─────────────
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

counterSchema.statics.getNextSequence = async function (sequenceName) {
  const result = await this.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return result.seq;
};

export const Counter = mongoose.model('Counter', counterSchema);

// ─── 2. Device Schema ──────────────────────────────────────────────
const deviceSchema = new mongoose.Schema(
  {
    system_id: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    imei: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: { type: String, trim: true },
    server_add: { type: String, default: 'localhost' },
    server_port: { type: String, default: '8080' },
    server_path: { type: String, default: '/' },
    registration_app: { type: String, default: 'api/register' },
    system_config_app: { type: String, default: 'api/system-config' },
    param_config_app: { type: String, default: 'api/param-config' },
    data_app: { type: String, default: 'api/data' },
    relay_config_app: { type: String, default: 'api/relay-config' },
    no_of_parameters: { type: Number, default: 0 },
    acq_interval_min: { type: Number, default: 1 },
    trans_interval_min: { type: Number, default: 1 },
    mqtt_broker: { type: String, default: 'broker.example.net' },
    mqtt_port: { type: Number, default: 1883 },
    mqtt_client_id: { type: String, default: '' },
    mqtt_username: { type: String, default: '' },
    mqtt_password: { type: String, default: '' },
    mqtt_command_topic: { type: String, default: '' },
    mqtt_status_topic: { type: String, default: '' },
    last_seen_at: { type: Date },
    created_at: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const Device = mongoose.model('Device', deviceSchema);

// ─── 3. DAQ Parameter Schema ───────────────────────────────────────
const deviceParameterSchema = new mongoose.Schema(
  {
    system_id: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    param_index: { type: Number, required: true },
    param_name: { type: String, required: true, maxlength: 9, trim: true },
    source_type: { type: Number, default: 12 },
    para_type: { type: Number, default: 0 },
    rs485_mode: { type: Number, default: 0 },
    rs485_data_type: { type: Number, default: 1 },
    baud_rate: { type: Number, default: 0 },
    data_bits: { type: Number, default: 0 },
    parity: { type: Number, default: 0 },
    stop_bits: { type: Number, default: 0 },
    timeout_ms: { type: Number, default: 3000 },
    mul_factor: { type: Number, default: 1.0 },
    add_factor: { type: Number, default: 0.0 },
    modbus_req_hex: { type: String, default: '', uppercase: true, trim: true },
  },
  { versionKey: false }
);

deviceParameterSchema.index({ system_id: 1, param_index: 1 }, { unique: true });

export const DeviceParameter = mongoose.model('DeviceParameter', deviceParameterSchema);

// ─── 4. Relay Module Schema ────────────────────────────────────────
const relayModuleSchema = new mongoose.Schema(
  {
    system_id: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    slave_id: { type: Number, required: true },
    channels: { type: Number, default: 8 },
    coil_start: { type: Number, default: 0 },
  },
  { versionKey: false }
);

relayModuleSchema.index({ system_id: 1, slave_id: 1 }, { unique: true });

export const RelayModule = mongoose.model('RelayModule', relayModuleSchema);

// ─── 5. Telemetry Schema ───────────────────────────────────────────
const telemetryValueSchema = new mongoose.Schema(
  {
    param_index: { type: Number, required: true },
    value: { type: Number, default: null },
    is_timeout: { type: Boolean, default: false },
    is_error: { type: Boolean, default: false },
  },
  { _id: false }
);

const telemetryRecordSchema = new mongoose.Schema(
  {
    system_id: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    device_timestamp: { type: Date, required: true },
    write_counter: { type: Number, required: true },
    acquisition_counter: { type: Number, required: true },
    signal_strength: { type: Number, default: 0 },
    relay1_status: { type: Boolean, default: false },
    relay2_status: { type: Boolean, default: false },
    relay3_status: { type: Boolean, default: false },
    values: [telemetryValueSchema],
    received_at: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

telemetryRecordSchema.index({ system_id: 1, device_timestamp: -1 });

export const TelemetryRecord = mongoose.model('TelemetryRecord', telemetryRecordSchema);

export default {
  Counter,
  Device,
  DeviceParameter,
  RelayModule,
  TelemetryRecord,
};
