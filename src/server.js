import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import pool from './db/pool.js';
import { runMigration } from './db/migrate.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

async function startServer() {
  try {
    console.log('[INIT] Checking database connection and running migrations...');
    await runMigration();
  } catch (err) {
    console.warn(
      '[INIT] Warning: Database migration failed. Ensure PostgreSQL is running and credentials in .env are correct.'
    );
    console.warn(`[INIT] Details: ${err.message}`);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 IoT Controller Backend listening on port ${PORT}`);
    console.log(`📡 Endpoints:`);
    console.log(`   POST /api/register      - Device Registration`);
    console.log(`   POST /api/system-config - System Configuration`);
    console.log(`   POST /api/param-config  - DAQ Parameter Config`);
    console.log(`   POST /api/data          - Telemetry Ingestion`);
    console.log(`   POST /api/relay-config  - Relay Module Config`);
    console.log(`   GET  /health            - Health Check`);
    console.log(`====================================================`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Closing server...`);
    server.close(async () => {
      try {
        await pool.end();
        console.log('[SHUTDOWN] Database pool closed. Exiting.');
      } catch (e) {
        console.error('[SHUTDOWN] Error closing database pool:', e);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer();
