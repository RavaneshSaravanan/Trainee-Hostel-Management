import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Automatically load backend/.env if not already loaded in environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config();
}

// In-memory dispatch queue to prevent concurrent rate-limit or socket spikes
let dispatchQueue = Promise.resolve();

export function enqueueGmailDispatch(fn) {
  const result = dispatchQueue.then(fn, fn);
  dispatchQueue = result.catch(() => {});
  return result;
}

// In-memory idempotency cache for duplicate email prevention (TTL: 30 seconds)
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 30 * 1000;

function cleanupIdempotencyCache() {
  const now = Date.now();
  for (const [key, item] of idempotencyCache.entries()) {
    if (now - item.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

// Dedicated in-memory MIME message builder (No SMTP transport, purely compiles RFC 2822 MIME)
const mimeBuilder = nodemailer.createTransport({
  streamTransport: true,
  buffer: true,
});

let oauth2ClientInstance = null;
let gmailClientInstance = null;

/**
 * Allows injecting a test or mock client for testing environments.
 */
export function setMockGmailClient(mockClient) {
  gmailClientInstance = mockClient;
}

/**
 * Checks whether all required Google Gmail API OAuth 2.0 credentials are present in environment.
 */
export function isGmailConfigured() {
  const user = process.env.GMAIL_USER;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  return Boolean(user && clientId && clientSecret && refreshToken);
}

/**
 * Returns safe Gmail configuration status without exposing tokens or secrets.
 */
export function getGmailConfigStatus() {
  return {
    configured: isGmailConfigured(),
    user: process.env.GMAIL_USER || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground',
    hasClientId: Boolean(process.env.GMAIL_CLIENT_ID),
    hasClientSecret: Boolean(process.env.GMAIL_CLIENT_SECRET),
    hasRefreshToken: Boolean(process.env.GMAIL_REFRESH_TOKEN),
  };
}

/**
 * Scrubs sensitive tokens, client secrets, and passwords from strings before logging or returning.
 */
export function scrubSensitive(str = '') {
  if (!str || typeof str !== 'string') return '';
  let cleaned = str;
  const secrets = [
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REFRESH_TOKEN,
    process.env.JWT_SECRET,
  ].filter(Boolean);

  for (const secret of secrets) {
    if (secret && secret.length > 4) {
      cleaned = cleaned.replaceAll(secret, '[REDACTED_SECRET]');
    }
  }

  // Scrub Google access tokens & refresh tokens by pattern
  cleaned = cleaned.replace(/ya29\.[a-zA-Z0-9_\-]+/g, '[REDACTED_ACCESS_TOKEN]');
  cleaned = cleaned.replace(/1\/\/[a-zA-Z0-9_\-]+/g, '[REDACTED_REFRESH_TOKEN]');
  return cleaned;
}

export function resetGmailClient() {
  oauth2ClientInstance = null;
  gmailClientInstance = null;
}

/**
 * Initializes and returns the authenticated Google OAuth2 client.
 * Uses refresh token to automatically acquire and refresh access tokens.
 */
export function getOAuth2Client() {
  if (!isGmailConfigured()) {
    oauth2ClientInstance = null;
    return null;
  }
  if (oauth2ClientInstance) return oauth2ClientInstance;

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground';
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({
    refresh_token: refreshToken,
  });

  // Safe token refresh listener: Logs token renewal without exposing token data
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      console.log('[Gmail API OAuth2] New refresh token received from Google authorization server.');
    }
    console.log('[Gmail API OAuth2] Access token automatically renewed via refresh token.');
  });

  oauth2ClientInstance = client;
  return oauth2ClientInstance;
}

/**
 * Returns authenticated Google Gmail v1 client.
 */
export function getGmailClient() {
  if (!isGmailConfigured() && !gmailClientInstance) {
    oauth2ClientInstance = null;
    return null;
  }
  if (gmailClientInstance) return gmailClientInstance;
  const auth = getOAuth2Client();
  if (!auth) return null;

  gmailClientInstance = google.gmail({ version: 'v1', auth });
  return gmailClientInstance;
}

/**
 * Verifies Gmail API connectivity and OAuth2 credentials by requesting an active access token.
 */
export async function verifyGmailConnection() {
  if (!isGmailConfigured()) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      error: 'Gmail API environment variables (GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN) are missing.',
    };
  }

  try {
    const auth = getOAuth2Client();
    if (!auth) {
      return { ok: false, status: 'AUTH_INIT_FAILED', error: 'Failed to initialize OAuth2 client' };
    }

    const tokenResponse = await auth.getAccessToken();
    if (!tokenResponse?.token) {
      return { ok: false, status: 'TOKEN_REFRESH_FAILED', error: 'Unable to acquire valid access token from refresh token' };
    }

    return {
      ok: true,
      status: 'CONNECTED',
      user: process.env.GMAIL_USER,
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
    };
  } catch (err) {
    const cleanErr = scrubSensitive(err.message);
    console.error('[Gmail API Connection Test Failed]:', cleanErr);
    return {
      ok: false,
      status: 'CONNECTION_ERROR',
      error: cleanErr,
    };
  }
}

/**
 * Builds RFC 2822 MIME message buffer and converts to URL-safe Base64 string for Gmail API.
 */
export async function buildRawMimeMessage({
  from,
  to,
  cc = [],
  bcc = [],
  subject,
  text,
  html,
  attachments = [],
  headers = {},
}) {
  const mailOptions = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  };

  const finalCc = Array.isArray(cc) ? cc.filter(Boolean) : [cc].filter(Boolean);
  if (finalCc.length > 0) mailOptions.cc = finalCc;

  const finalBcc = Array.isArray(bcc) ? bcc.filter(Boolean) : [bcc].filter(Boolean);
  if (finalBcc.length > 0) mailOptions.bcc = finalBcc;

  if (Array.isArray(attachments) && attachments.length > 0) {
    mailOptions.attachments = attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
      encoding: att.encoding,
      cid: att.cid,
    }));
  }

  mailOptions.headers = {
    'X-Mailer': 'Apollo Tyres Trainee Hostel Management (Google Gmail API)',
    ...headers,
  };

  const compiled = await mimeBuilder.sendMail(mailOptions);
  const rawBuffer = compiled.message;

  // Base64URL encoding (RFC 4648 § 5)
  const base64Url = rawBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { raw: base64Url, buffer: rawBuffer, messageId: compiled.messageId };
}

/**
 * Helper to determine whether an error is transient and eligible for retry.
 */
function isTransientError(err) {
  const status = err.response?.status || err.code;
  // Retry on rate limit (429), server errors (500, 502, 503, 504), network timeouts
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'SOCKETTIMEDOUT'].includes(err.code)) return true;
  if (err.message && (err.message.includes('rateLimitExceeded') || err.message.includes('userRateLimitExceeded'))) return true;
  return false;
}

/**
 * Sleep helper for retry backoff
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Core function to send an email via Google Gmail API (HTTPS users.messages.send).
 * Includes:
 * - Exponential backoff retry mechanism with jitter for transient errors.
 * - In-memory duplicate suppression within 30-second window.
 * - Accurate response tracking (id, threadId, labelIds).
 * - Safe error logging and redaction.
 */
export async function sendMailViaGmail({
  from,
  to,
  cc = [],
  bcc = [],
  subject,
  text,
  html,
  attachments = [],
  emailType = 'GENERAL',
  traineeId = '',
  traineeName = '',
  triggeredBy = 'System',
  force = false,
  metadata = {},
  maxRetries = 3,
}) {
  cleanupIdempotencyCache();

  const primaryToList = Array.isArray(to) ? to : [to];
  const recipientKey = primaryToList.map((e) => String(e).trim().toLowerCase()).sort().join(',');

  // Duplicate-email prevention hash (to + subject + type + traineeId)
  const hashKey = crypto
    .createHash('sha256')
    .update(`${recipientKey}:${emailType}:${traineeId}:${subject}`)
    .digest('hex');

  if (!force && idempotencyCache.has(hashKey)) {
    const cached = idempotencyCache.get(hashKey);
    console.warn(`[Gmail API Duplicate Prevention] Suppressed duplicate email dispatch for key: ${hashKey} (${emailType} to ${recipientKey})`);
    return {
      ok: true,
      status: 'DEDUPLICATED',
      messageId: cached.messageId,
      threadId: cached.threadId,
      to: primaryToList,
      cc,
      bcc,
      duplicatePrevented: true,
    };
  }

  const senderUser = process.env.GMAIL_USER || 'apollotyres.hostel@gmail.com';
  const effectiveFrom = from || `Apollo Tyres Ltd Hostel Administration <${senderUser}>`;

  // Compile RFC 2822 MIME message
  const { raw, messageId: localMessageId } = await buildRawMimeMessage({
    from: effectiveFrom,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    attachments,
  });

  const gmail = getGmailClient();
  if (!gmail) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      error: 'Gmail API client could not be initialized. Verify environment configuration (GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).',
      to: primaryToList,
      cc,
      bcc,
    };
  }

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;
    const startTime = Date.now();

    try {
      const response = await enqueueGmailDispatch(() =>
        gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw,
          },
        })
      );

      const durationMs = Date.now() - startTime;
      const gmailMessageId = response?.data?.id || localMessageId;
      const threadId = response?.data?.threadId;
      const labelIds = response?.data?.labelIds || ['SENT'];

      // Cache successful dispatch for idempotency
      idempotencyCache.set(hashKey, {
        timestamp: Date.now(),
        messageId: gmailMessageId,
        threadId,
      });

      console.log(`[Gmail API Dispatch Succeeded] MessageId: ${gmailMessageId}, Attempt: ${attempt}, Duration: ${durationMs}ms`);

      return {
        ok: true,
        status: 'SENT',
        messageId: gmailMessageId,
        threadId,
        labelIds,
        attempts: attempt,
        durationMs,
        to: primaryToList,
        cc,
        bcc,
      };
    } catch (err) {
      lastError = err;
      const isTransient = isTransientError(err);
      const cleanErrMsg = scrubSensitive(err.response?.data?.error?.message || err.message);

      console.warn(`[Gmail API Attempt ${attempt} Failed]: ${cleanErrMsg} (Transient: ${isTransient})`);

      if (isTransient && attempt <= maxRetries) {
        // Exponential backoff with random jitter (e.g., 1000ms * 2^(attempt-1) + jitter)
        const backoffMs = 1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
        console.log(`[Gmail API Retry] Retrying in ${backoffMs}ms (Attempt ${attempt + 1}/${maxRetries + 1})...`);
        await sleep(backoffMs);
      } else {
        // Non-transient error or maximum retries exhausted
        break;
      }
    }
  }

  const finalErrMsg = scrubSensitive(lastError?.response?.data?.error?.message || lastError?.message || 'Unknown Gmail API dispatch failure');
  console.error(`[Gmail API Dispatch Failed Permanently] Attempts: ${attempt}, Error: ${finalErrMsg}`);

  return {
    ok: false,
    status: 'FAILED',
    error: finalErrMsg,
    statusCode: lastError?.response?.status || 500,
    attempts: attempt,
    to: primaryToList,
    cc,
    bcc,
  };
}
