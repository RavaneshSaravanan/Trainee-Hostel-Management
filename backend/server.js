import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { connectDB, closeDB } from './config/db.js';
import { seedDatabase } from './seed.js';
import { verifySmtpConnection, getTransporter, getEmailProvider, isEmailConfigured } from './services/emailService.js';

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

// Trust reverse proxy (Render, Vercel, etc.) for accurate client IPs and rate limiting
app.set('trust proxy', 1);

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
  const provider = getEmailProvider();
  const emailConfigured = isEmailConfigured();
  res.json({
    status: dbStatus === 1 ? 'healthy' : 'degraded',
    database: dbStatusMap[dbStatus] || 'unknown',
    emailConfigured,
    emailProvider: provider,
    smtpConfigured: !!getTransporter(),
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ---------------- Temporary Isolated SMTP Port 2525 Diagnostic Test ----------------
async function probeTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let banner = '';
    const socket = net.createConnection({ host, port, timeout: timeoutMs });

    socket.on('connect', () => {
      const connectTime = Date.now() - start;
      setTimeout(() => {
        socket.destroy();
        resolve({
          connected: true,
          connectTimeMs: connectTime,
          banner: banner.trim() || 'Connected, but no SMTP greeting banner received within 1.5s',
        });
      }, 1500);
    });

    socket.on('data', (chunk) => {
      banner += chunk.toString();
    });

    socket.on('timeout', () => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({
        connected: false,
        error: `Connection timed out after ${elapsed}ms`,
        code: 'ETIMEDOUT',
        elapsedMs: elapsed,
      });
    });

    socket.on('error', (err) => {
      const elapsed = Date.now() - start;
      resolve({
        connected: false,
        error: err.message,
        code: err.code || 'ERR_TCP',
        elapsedMs: elapsed,
      });
    });
  });
}

async function probeNodemailerPort(host, port, user, pass) {
  const testTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: user || 'diagnostics@gmail.com', pass: pass || 'dummy-pass' },
    connectionTimeout: 5000,
    greetingTimeout: 4000,
    socketTimeout: 5000,
  });

  const start = Date.now();
  try {
    await testTransporter.verify();
    return {
      verified: true,
      timeMs: Date.now() - start,
      message: 'SMTP handshake and authentication succeeded',
    };
  } catch (err) {
    return {
      verified: false,
      timeMs: Date.now() - start,
      error: err.message,
      code: err.code || 'ERR_NODEMAILER',
      command: err.command || null,
    };
  }
}

app.get('/api/test-smtp-2525', async (req, res) => {
  const host = 'smtp.gmail.com';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  // 1. Probe Port 2525 TCP connectivity
  const tcp2525 = await probeTcp(host, 2525, 5000);

  // 2. Probe comparison ports 587 and 465
  const tcp587 = await probeTcp(host, 587, 5000);
  const tcp465 = await probeTcp(host, 465, 5000);

  // 3. Probe Nodemailer on Port 2525 (credentials hidden from logs)
  const nodemailer2525 = await probeNodemailerPort(host, 2525, user, pass);

  const supports2525 = tcp2525.connected && !tcp2525.error;

  return res.json({
    host,
    testedPort: 2525,
    timestamp: new Date().toISOString(),
    isRenderFreeInstance: Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.IS_PULL_REQUEST),
    results: {
      port2525: {
        tcp: tcp2525,
        nodemailer: nodemailer2525,
        supportedByGmail: false,
      },
      comparison: {
        port587_STARTTLS: tcp587,
        port465_SSL: tcp465,
      },
    },
    officialGmailSupport: {
      port587: 'Officially supported (STARTTLS)',
      port465: 'Officially supported (SSL/TLS)',
      port25: 'Officially supported (standard plaintext/TLS; commonly blocked by cloud providers)',
      port2525: 'NOT supported by Google smtp.gmail.com (Used by third-party ESPs like SendGrid/Mailgun, but Google does not listen on 2525)',
    },
    conclusion: supports2525
      ? 'Unexpected: TCP connected to smtp.gmail.com on port 2525.'
      : 'Confirmed: smtp.gmail.com does not respond on port 2525 (Connection timed out / ETIMEDOUT). Gmail SMTP cannot work on port 2525.',
  });
});

// Database readiness check for API routes
app.use('/api', (req, res, next) => {
  // Allow health check, public config, and revision polling without blocking
  if (
    req.path === '/health' ||
    req.path === '/test-smtp-2525' ||
    req.path === '/public' ||
    req.path === '/rev' ||
    req.path === '/reviews/summary'
  ) return next();

  if (mongoose.connection.readyState === 1) {
    return next();
  }

  // If disconnected, trigger reconnection
  if (mongoose.connection.readyState === 0) {
    connectDB().catch((err) => console.warn('[Auto-reconnect warning]', err.message));
  }

  // If connecting or reconnecting, wait gracefully up to 15 seconds for Atlas/cloud handshake
  let retries = 0;
  const interval = setInterval(() => {
    retries++;
    if (mongoose.connection.readyState === 1) {
      clearInterval(interval);
      return next();
    }
    if (retries > 150) { // 15s wait
      clearInterval(interval);
      return res.status(503).json({
        error: 'Database connection in progress. Please retry in a moment.',
        code: 'DB_CONNECTING',
      });
    }
  }, 100);
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

  // Bind HTTP server immediately so Render detects port binding
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hostel backend running on port ${PORT}`);
  });

  try {
    await connectDB();
    await seedDatabase();
  } catch (dbErr) {
    console.error('[Startup DB Warning] Initial MongoDB connection postponed:', dbErr.message);
    console.log('[Startup DB] Background readiness middleware will connect on incoming requests.');
  }

  await verifySmtpConnection().catch((err) => {
    console.warn('[Startup] Non-fatal Email verification warning:', err.message);
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
