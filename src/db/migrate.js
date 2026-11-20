import { connectDB, closeDB } from './connection.js';
import { Device, DeviceParameter, RelayModule, TelemetryRecord, Counter } from './models/index.js';

export async function runMigration() {
  try {
    await connectDB();

    console.log('[DB] Ensuring indexes for all MongoDB collections...');
    await Promise.all([
      Device.init(),
      DeviceParameter.init(),
      RelayModule.init(),
      TelemetryRecord.init(),
      Counter.init(),
    ]);

    // Ensure device_id counter is initialized
    const existingCounter = await Counter.findById('device_id');
    if (!existingCounter) {
      await Counter.create({ _id: 'device_id', seq: 0 });
      console.log('[DB] Initialized device_id sequence counter to 0');
    }

    console.log('[DB] MongoDB schema initialization and index creation completed successfully');
  } catch (err) {
    console.error('[DB] Migration/Initialization failed:', err.message);
    throw err;
  }
}

// Allow standalone execution: npm run db:migrate or npm run db:init
if (process.argv[1]?.replace(/\\/g, '/').includes('db/migrate')) {
  const { config } = await import('dotenv');
  config();
  try {
    await runMigration();
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await closeDB();
  }
}
