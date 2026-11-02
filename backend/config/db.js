import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

let memoryServer = null;
let connectingPromise = null;

// Mask MongoDB credentials in logs
export function maskMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';

  return uri.replace(
    /\/\/[^:]+:[^@]+@/,
    '//***:***@'
  );
}

// Connection lifecycle event listeners
mongoose.connection.on('connected', () => {
  console.log('[Database] MongoDB connected successfully.');
});

mongoose.connection.on('disconnected', () => {
  console.warn(
    '[Database] MongoDB connection disconnected. Monitoring reconnection...'
  );
});

mongoose.connection.on('reconnected', () => {
  console.log('[Database] MongoDB connection restored successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error('[Database] MongoDB runtime error:', err.message);
});

// Connect to MongoDB
export async function connectDB() {
  // Already connected
  if (mongoose.connection.readyState === 1) {
    console.log('[Database] Already connected.');
    return mongoose.connection;
  }

  // Reuse an ongoing connection attempt
  if (connectingPromise) {
    return connectingPromise;
  }

  const envUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    'mongodb://localhost:27017/trainee-hostel';

  const isAtlas =
    envUri.startsWith('mongodb+srv://') ||
    envUri.includes('.mongodb.net');

  const isLocal =
    envUri.includes('localhost') ||
    envUri.includes('127.0.0.1');

  const options = {
    dbName: 'trainee-hostel',
    serverSelectionTimeoutMS: isAtlas ? 15000 : 2500,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 0,
    autoIndex: true,
  };

  connectingPromise = (async () => {
    try {
      console.log('[Database] Connecting to MongoDB...');

      const conn = await mongoose.connect(envUri, options);

      const host = conn.connection.host || 'unknown';
      const dbName = conn.connection.name || 'trainee-hostel';

      console.log(
        `[Database] MongoDB Connected Successfully: ${host}/${dbName} (${isAtlas ? 'MongoDB Atlas' : 'Local MongoDB'})`
      );

      return conn;
    } catch (err) {
      console.error(
        '[Database] MongoDB Connection Error:',
        err.message
      );

      // Local MongoDB fallback
      if (isLocal && !isAtlas) {
        try {
          console.warn(
            '[Database] Local MongoDB unavailable. Starting embedded MongoDB...'
          );

          const { MongoMemoryServer } = await import(
            'mongodb-memory-server'
          );

          memoryServer = await MongoMemoryServer.create();

          const memoryUri = memoryServer.getUri();

          const conn = await mongoose.connect(memoryUri, {
            dbName: 'trainee-hostel',
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 10,
            autoIndex: true,
          });

          console.log(
            `[Database] Embedded MongoDB Connected Successfully: ${conn.connection.host}/${conn.connection.name}`
          );

          return conn;
        } catch (memoryError) {
          console.error(
            '[Database] Embedded MongoDB Error:',
            memoryError.message
          );

          throw memoryError;
        }
      }

      if (isAtlas) {
        console.error(`
[Database] MongoDB Atlas troubleshooting:

1. Check your MONGODB_URI in .env.
2. Verify MongoDB Atlas cluster status.
3. Check Network Access IP whitelist.
4. Verify database username and password.
5. Check your internet and DNS connectivity.
6. Confirm that your Atlas cluster is running.
        `);
      }

      throw err;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

// Graceful shutdown
export async function closeDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();

      console.log(
        '[Database] MongoDB connection closed gracefully.'
      );
    }

    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;

      console.log(
        '[Database] Embedded MongoDB stopped.'
      );
    }
  } catch (err) {
    console.error(
      '[Database] Error while closing MongoDB:',
      err.message
    );
  }
}
