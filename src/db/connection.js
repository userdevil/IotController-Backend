import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/iot_controller';

let isConnected = false;

/**
 * Connect to MongoDB database
 * @param {string} [customUri]
 */
export async function connectDB(customUri) {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = customUri || process.env.MONGODB_URI || DEFAULT_URI;

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`[DB] Connected to MongoDB: ${conn.connection.name} @ ${conn.connection.host}:${conn.connection.port}`);
    return conn.connection;
  } catch (err) {
    console.error(`[DB] Failed to connect to MongoDB: ${err.message}`);
    throw err;
  }
}

/**
 * Close MongoDB connection
 */
export async function closeDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('[DB] MongoDB connection closed');
  }
}

export default {
  connectDB,
  closeDB,
  connection: mongoose.connection,
};
