import mongoose from 'mongoose';

let memoryServer = null;

export function maskMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/trainee-hostel';
  const isAtlas = uri.startsWith('mongodb+srv://') || uri.includes('.mongodb.net');
  const isLocal = !uri || uri.includes('localhost') || uri.includes('127.0.0.1');

  const options = {
    serverSelectionTimeoutMS: isAtlas ? 8000 : 2500,
    socketTimeoutMS: 45000,
    maxPoolSize: 20,
    minPoolSize: 2,
    autoIndex: true,
  };

  try {
    const conn = await mongoose.connect(uri, options);
    const host = conn.connection.host || 'unknown';
    const dbName = conn.connection.name || 'trainee-hostel';
    console.log(`[Database] MongoDB Connected: ${host}/${dbName} (${isAtlas ? 'MongoDB Atlas' : 'Local MongoDB'})`);
    return conn;
  } catch (error) {
    // If local MongoDB is not running and no Atlas URI is provided, fall back to embedded MongoDB for testing/offline dev
    if (isLocal && !isAtlas) {
      console.warn(`[Database] Local MongoDB daemon is not running on port 27017.`);
      console.log(`[Database] Starting embedded in-memory MongoDB engine...`);
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      const memoryUri = memoryServer.getUri();
      const conn = await mongoose.connect(memoryUri, {
        serverSelectionTimeoutMS: 5000,
        autoIndex: true,
      });
      console.log(`[Database] Embedded MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn;
    }

    console.error(`[Database] MongoDB Connection Error: ${error.message}`);
    throw error;
  }
}

// Connection lifecycle event listeners
mongoose.connection.on('disconnected', () => {
  console.warn('[Database] MongoDB connection disconnected.');
});

mongoose.connection.on('reconnected', () => {
  console.log('[Database] MongoDB connection restored.');
});

mongoose.connection.on('error', (err) => {
  console.error('[Database] MongoDB runtime error:', err.message);
});

// Graceful shutdown helper
export async function closeDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      console.log('[Database] MongoDB connection closed gracefully.');
    }
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  } catch (err) {
    console.error('[Database] Error while closing MongoDB connection:', err.message);
  }
}
