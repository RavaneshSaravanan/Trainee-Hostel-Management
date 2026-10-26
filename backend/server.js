import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { connectDB, closeDB } from './config/db.js';
import { seedDatabase } from './seed.js';

import authRoutes from './routes/auth.js';
import publicRoutes from './routes/publicRoutes.js';
import usersRoutes from './routes/users.js';
import stateRoutes from './routes/state.js';
import reportsRoutes from './routes/reports.js';

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

// Security & Parsing
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) return callback(null, true);
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api', authRoutes);
app.use('/api', publicRoutes);
app.use('/api', usersRoutes);
app.use('/api', stateRoutes);
app.use('/api', reportsRoutes);

// Production frontend serving
const DIST = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('API running. Use `npm run dev` in frontend (port 5173) or run `npm run build`.');
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
