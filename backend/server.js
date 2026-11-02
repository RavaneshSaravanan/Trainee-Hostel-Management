import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB, closeDB } from './config/db.js';
import { seedDatabase } from './seed.js';

import authRoutes from './routes/auth.js';
import publicRoutes from './routes/publicRoutes.js';
import usersRoutes from './routes/users.js';
import stateRoutes from './routes/state.js';
import reportsRoutes from './routes/reports.js';
import approvalRoutes from './routes/approval.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import validityRoutes from './routes/validity.js';
import recordsRoutes from './routes/recordsRoutes.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;
const app = express();

// Validate required environment variables at startup
function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (isProd && !mongoUri) {
    console.error('FATAL: MONGODB_URI is required in production environment.');
    process.exit(1);
  }

  if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('secret_jwt_key'))) {
    console.warn('SECURITY WARNING: Using a default or weak JWT_SECRET in production is unsafe.');
  }

  console.log(`[Config] Environment: ${process.env.NODE_ENV || 'development'}, Port: ${PORT}`);
}

// Security headers with cross-origin resource access allowed
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Dynamic CORS configuration supporting Vercel production, preview deployments, and local development
const defaultOrigins = [
  'https://trainee-hostel-management.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

const envOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
  : [];

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/+$/, '');

    // Allow configured origins
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    // Allow Vercel preview branch deployments
    if (/^https:\/\/trainee-hostel-management.*\.vercel\.app$/.test(normalizedOrigin)) {
      return callback(null, true);
    }

    // In development mode, allow any local origin
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200,
};

// Mount CORS middleware & handle OPTIONS preflight explicitly
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint (reports process uptime and MongoDB connection state)
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  res.json({
    status: dbStatus === 1 ? 'healthy' : 'degraded',
    database: dbStatusMap[dbStatus] || 'unknown',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Database readiness check for API routes
app.use('/api', (req, res, next) => {
  // Allow health check without blocking
  if (req.path === '/health') return next();

  if (mongoose.connection.readyState === 1) {
    return next();
  }

  // If currently connecting, wait briefly
  if (mongoose.connection.readyState === 2) {
    let retries = 0;
    const interval = setInterval(() => {
      retries++;
      if (mongoose.connection.readyState === 1) {
        clearInterval(interval);
        return next();
      }
      if (retries > 25) { // 2.5s wait
        clearInterval(interval);
        return res.status(503).json({ error: 'Database is initializing. Please try again in a moment.' });
      }
    }, 100);
    return;
  }

  return res.status(503).json({ error: 'Database service unavailable. Please retry shortly.' });
});

// API routes
app.use('/api', authRoutes);
app.use('/api', publicRoutes);
app.use('/api', usersRoutes);
app.use('/api', stateRoutes);
app.use('/api', reportsRoutes);
app.use('/api', approvalRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', validityRoutes);
app.use('/api', recordsRoutes);

// Production frontend serving (if built as monolith)
const DIST = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('Trainee Hostel Management Backend API is running.');
  });
}

// 404 handler for unmatched API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

let httpServer = null;

export async function startServer() {
  validateEnv();
  await connectDB();
  await seedDatabase();
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hostel backend running on http://localhost:${PORT}`);
  });
  return httpServer;
}

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(`\n[Process] Received ${signal}. Initiating graceful shutdown...`);
  if (httpServer) {
    httpServer.close(() => {
      console.log('[Process] HTTP server closed.');
    });
  }
  await closeDB();
  console.log('[Process] Graceful shutdown completed.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Run if called directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export default app;
