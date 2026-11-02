// import mongoose from 'mongoose';
// import dns from 'node:dns';
// import dotenv from 'dotenv';

// dotenv.config();

// if (dns.setDefaultResultOrder) {
//   try {
//     dns.setDefaultResultOrder('ipv4first');
//   } catch {
//     // Ignore if not supported in environment
//   }
// }

// let memoryServer = null;

// export function maskMongoUri(uri) {
//   if (!uri || typeof uri !== 'string') return '';
//   return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
// }

// export function getDirectReplicaUri(srvUri) {
//   if (!srvUri || typeof srvUri !== 'string') return null;
//   if (!srvUri.startsWith('mongodb+srv://')) return srvUri;

//   if (srvUri.includes('multimedia.elanjfe.mongodb.net')) {
//     const match = srvUri.match(/^mongodb\+srv:\/\/([^@]+)@multimedia\.elanjfe\.mongodb\.net(?:\/([^?]*))?(?:\?(.*))?$/);
//     if (match) {
//       const auth = match[1];
//       const db = match[2] || 'trainee-hostel';
//       const hosts = [
//         'ac-8spmpgb-shard-00-00.elanjfe.mongodb.net:27017',
//         'ac-8spmpgb-shard-00-01.elanjfe.mongodb.net:27017',
//         'ac-8spmpgb-shard-00-02.elanjfe.mongodb.net:27017',
//       ].join(',');
//       return `mongodb://${auth}@${hosts}/${db}?ssl=true&replicaSet=atlas-8spmpgb-shard-0&authSource=admin&retryWrites=true&w=majority`;
//     }
//   }

//   return null;
// }

// export async function connectDB() {
//   const envUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/trainee-hostel';
//   const directReplicaUri = process.env.MONGODB_DIRECT_URI || getDirectReplicaUri(envUri);
//   const isAtlas = envUri.startsWith('mongodb+srv://') || envUri.includes('.mongodb.net');
//   const isLocal = !envUri || envUri.includes('localhost') || envUri.includes('127.0.0.1');

//   const options = {
//     dbName: 'trainee-hostel',
//     serverSelectionTimeoutMS: isAtlas ? 10000 : 2500,
//     socketTimeoutMS: 45000,
//     maxPoolSize: 20,
//     minPoolSize: 2,
//     autoIndex: true,
//   };

//   const urisToTry = [];
//   urisToTry.push({ uri: envUri, label: isAtlas ? 'MongoDB Atlas' : 'Local MongoDB' });

//   if (directReplicaUri && directReplicaUri !== envUri) {
//     urisToTry.push({ uri: directReplicaUri, label: 'MongoDB Atlas Direct Replica Set' });
//   }

//   let lastError;
//   for (const { uri: targetUri, label } of urisToTry) {
//     for (let attempt = 1; attempt <= 2; attempt++) {
//       try {
//         const conn = await mongoose.connect(targetUri, options);
//         const host = conn.connection.host || 'unknown';
//         const dbName = conn.connection.name || 'trainee-hostel';
//         console.log(`[Database] MongoDB Connected Successfully: ${host}/${dbName} (${label})`);
//         return conn;
//       } catch (err) {
//         lastError = err;
//         const isDnsError = err.message && (err.message.includes('querySrv') || err.message.includes('ECONNREFUSED'));

//         if (attempt === 1 && isAtlas && isDnsError) {
//           console.warn(`[Database] DNS SRV query failed (${err.message}). Retrying...`);
//           try {
//             dns.setServers(['8.8.8.8', '1.1.1.1']);
//           } catch {
//             // ignore
//           }
//           await new Promise((r) => setTimeout(r, 1200));
//           continue;
//         }

//         if (isDnsError && directReplicaUri && targetUri !== directReplicaUri) {
//           console.warn(`[Database] SRV lookup failed. Switching to direct replica set connection...`);
//           break;
//         }

//         if (attempt < 2 && isAtlas) {
//           await new Promise((r) => setTimeout(r, 1200));
//         }
//       }
//     }
//   }

//   if (isLocal && !isAtlas) {
//     console.warn(`[Database] Local MongoDB daemon is not running on port 27017.`);
//     console.log(`[Database] Starting embedded in-memory MongoDB engine...`);
//     const { MongoMemoryServer } = await import('mongodb-memory-server');
//     memoryServer = await MongoMemoryServer.create();
//     const memoryUri = memoryServer.getUri();
//     const conn = await mongoose.connect(memoryUri, {
//       dbName: 'trainee-hostel',
//       serverSelectionTimeoutMS: 5000,
//       autoIndex: true,
//     });
//     console.log(`[Database] Embedded MongoDB Connected Successfully: ${conn.connection.host}/${conn.connection.name}`);
//     return conn;
//   }

//   console.error(`[Database] MongoDB Connection Error: ${lastError.message}`);
//   if (isAtlas) {
//     console.error('\n[Database] How to fix:');
//     console.error('  1. Open MongoDB Atlas (https://cloud.mongodb.com)');
//     console.error('  2. Select your project ("cluster0.bhnzpky.mongodb.net")');
//     console.error('  3. Go to "Security" -> "Network Access"');
//     console.error('  4. Click "Add IP Address" -> Select "ALLOW ACCESS FROM ANYWHERE" (0.0.0.0/0) -> Click "Confirm"');
//     console.error('  5. Wait ~30 seconds for Atlas to apply changes, then restart backend.\n');
//   }
//   throw lastError;
// }

// // Connection lifecycle event listeners
// mongoose.connection.on('disconnected', () => {
//   console.warn('[Database] MongoDB connection disconnected.');
// });

// mongoose.connection.on('reconnected', () => {
//   console.log('[Database] MongoDB connection restored.');
// });

// mongoose.connection.on('error', (err) => {
//   console.error('[Database] MongoDB runtime error:', err.message);
// });

// // Graceful shutdown helper
// export async function closeDB() {
//   try {
//     if (mongoose.connection.readyState !== 0) {
//       await mongoose.connection.close(false);
//       console.log('[Database] MongoDB connection closed gracefully.');
//     }
//     if (memoryServer) {
//       await memoryServer.stop();
//       memoryServer = null;
//     }
//   } catch (err) {
//     console.error('[Database] Error while closing MongoDB connection:', err.message);
//   }
// }

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
