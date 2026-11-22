/**
 * Resend API Client & Dispatch Engine
 * Official Node.js SDK Integration for Trainee Hostel Management System
 * 
 * Capabilities:
 * - Initializes official Resend Node.js SDK
 * - Strict sender resolution honoring verified domains (EMAIL_FROM, RESEND_FROM)
 * - Anti-duplicate dispatch idempotency cache (TTL: 30s)
 * - Automatic exponential backoff retry for transient network/rate-limit issues
 * - Clean structured logging with masked recipients
 * - Distinguishes Gateway Acceptance from Delivery
 */

import { Resend } from 'resend';
import crypto from 'node:crypto';
import { isValidEmail } from '../utils/validators.js';

let resendInstance = null;
let mockResendClient = null;

/**
 * Mask recipient email address for privacy in production server logs.
 * Example: "rahul.sharma@example.com" -> "ra***@example.com"
 */
export function maskEmailForLogs(email) {
  if (!email || typeof email !== 'string') return '***';
  const trimmed = email.trim();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * In-memory idempotency cache to prevent duplicate email transmissions
 * within a 30-second window (e.g. rapid double-clicks on submit).
 */
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

/**
 * Computes a hash key from recipients, subject, and content to detect duplicate transmissions.
 */
function computeEmailFingerprint(toList, subject, content) {
  const payload = `${toList.sort().join(',')}|${subject}|${content.slice(0, 500)}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Returns the active Resend SDK client instance, reusing the singleton.
 */
export function getResendClient() {
  if (mockResendClient) return mockResendClient;

  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;

  if (!resendInstance || resendInstance.key !== apiKey) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

/**
 * Allows injecting a mock Resend client for unit and integration testing.
 */
export function setMockResendClient(mock) {
  mockResendClient = mock;
}

export function resetMockResendClient() {
  mockResendClient = null;
}

/**
 * Checks whether Resend API is configured in environment variables.
 */
export function isResendConfigured() {
  if (mockResendClient) return true;
  const key = (process.env.RESEND_API_KEY || '').trim();
  return Boolean(key && key.startsWith('re_'));
}

/**
 * Resolves the verified sender address.
 * Prioritizes:
 * 1. process.env.EMAIL_FROM (e.g. "Apollo Tyres Ltd <notifications@hostel.apollotyres.com>")
 * 2. process.env.RESEND_FROM
 * 3. requestedFrom parameter (if custom valid domain)
 * 4. Resend onboarding sandbox fallback: "Apollo Tyres Ltd <onboarding@resend.dev>"
 */
export function resolveSenderAddress(requestedFrom) {
  const envEmailFrom = (process.env.EMAIL_FROM || '').trim();
  if (envEmailFrom) {
    const match = envEmailFrom.match(/^(.*?)(?:<(.+?)>)?$/);
    const candidate = (match && match[2] ? match[2] : envEmailFrom).trim();
    if (isValidEmail(candidate)) return envEmailFrom;
  }

  const envResendFrom = (process.env.RESEND_FROM || '').trim();
  if (envResendFrom) {
    const match = envResendFrom.match(/^(.*?)(?:<(.+?)>)?$/);
    const candidate = (match && match[2] ? match[2] : envResendFrom).trim();
    if (isValidEmail(candidate)) return envResendFrom;
  }

  if (requestedFrom) {
    const match = requestedFrom.match(/<(.+?)>/) || [null, requestedFrom];
    const candidateEmail = (match[1] || requestedFrom).trim();
    const domain = candidateEmail.split('@')[1]?.toLowerCase() || '';
    const publicDomains = ['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
    if (isValidEmail(candidateEmail) && !publicDomains.includes(domain)) {
      return requestedFrom;
    }
  }

  return 'Apollo Tyres Ltd <onboarding@resend.dev>';
}

/**
 * Verifies the Resend API connection status and API key validity.
 */
export async function verifyResendConnection() {
  if (!isResendConfigured()) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      error: 'RESEND_API_KEY is missing or invalid in backend/.env',
      provider: 'resend',
    };
  }

  const client = getResendClient();
  const configuredSender = resolveSenderAddress();

  try {
    // Probe Resend API using apiKeys.list or domains.list to verify authorization without sending an email
    if (client.apiKeys && typeof client.apiKeys.list === 'function') {
      const { data, error } = await client.apiKeys.list();
      if (error) {
        return {
          ok: false,
          status: 'UNAUTHORIZED',
          error: error.message || 'Resend API key authorization failed',
          provider: 'resend',
        };
      }
    } else if (client.domains && typeof client.domains.list === 'function') {
      const { data, error } = await client.domains.list();
      if (error) {
        return {
          ok: false,
          status: 'UNAUTHORIZED',
          error: error.message || 'Resend API key authorization failed',
          provider: 'resend',
        };
      }
    }

    return {
      ok: true,
      status: 'CONNECTED',
      provider: 'resend',
      sender: configuredSender,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'FAILED',
      error: err.message || 'Could not connect to Resend API endpoint',
      provider: 'resend',
    };
  }
}

/**
 * Dispatches an email using the official Resend SDK with retry logic.
 */
export async function sendEmailViaResendSdk({
  from,
  to,
  cc = [],
  bcc = [],
  subject,
  html,
  text,
  attachments = [],
  tags = [],
  headers = {},
}) {
  const client = getResendClient();
  if (!client) {
    throw new Error('Resend is not configured: RESEND_API_KEY is missing from environment variables');
  }

  // Sanitize and validate recipient lists
  const toList = (Array.isArray(to) ? to : [to])
    .map((e) => String(e || '').trim())
    .filter((e) => isValidEmail(e));

  if (toList.length === 0) {
    throw new Error('Resend dispatch failed: No valid recipient email addresses specified');
  }

  const ccList = (Array.isArray(cc) ? cc : [cc])
    .map((e) => String(e || '').trim())
    .filter((e) => isValidEmail(e));

  const bccList = (Array.isArray(bcc) ? bcc : [bcc])
    .map((e) => String(e || '').trim())
    .filter((e) => isValidEmail(e));

  const sender = resolveSenderAddress(from);

  // Idempotency check: prevent duplicate submissions within 30 seconds
  cleanupIdempotencyCache();
  const fingerprint = computeEmailFingerprint(toList, subject, html || text || '');
  if (idempotencyCache.has(fingerprint)) {
    const cached = idempotencyCache.get(fingerprint);
    console.log(`[RESEND IDEMPOTENCY] Suppressed duplicate email dispatch to [${toList.map(maskEmailForLogs).join(', ')}] with subject "${subject}" (cached ID: ${cached.id})`);
    return {
      ok: true,
      status: 'ACCEPTED',
      id: cached.id,
      messageId: cached.id,
      provider: 'resend',
      cached: true,
      deliveryState: 'QUEUED_BY_GATEWAY',
    };
  }

  // Format attachments for official Resend Node SDK
  const formattedAttachments = attachments.map((att) => {
    let content = att.content;
    if (typeof content === 'string' && !Buffer.isBuffer(content)) {
      // If it's a base64 string, convert to Buffer for SDK consistency
      content = Buffer.from(content, 'base64');
    }
    return {
      filename: att.filename || 'attachment.pdf',
      content,
    };
  });

  const payload = {
    from: sender,
    to: toList,
    subject: subject || 'Hostel Notification',
    html: html || text || '',
    text: text || undefined,
  };

  if (ccList.length > 0) payload.cc = ccList;
  if (bccList.length > 0) payload.bcc = bccList;
  if (formattedAttachments.length > 0) payload.attachments = formattedAttachments;
  if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;
  if (headers && Object.keys(headers).length > 0) payload.headers = headers;

  // Execute dispatch with exponential backoff for transient 429/5xx errors
  let attempt = 0;
  const maxRetries = 2;

  while (true) {
    attempt++;
    try {
      const response = await client.emails.send(payload);

      if (response.error) {
        const err = response.error;
        const statusCode = err.statusCode || 400;
        const errorMsg = `Resend API Error (${statusCode}): ${err.message || err.name || 'Unknown error'}`;

        // Check if retryable (429 rate limit or 5xx server error)
        const isRetryable = statusCode === 429 || (statusCode >= 500 && statusCode < 600);
        if (attempt <= maxRetries && isRetryable) {
          const backoffMs = attempt * 1000 + Math.floor(Math.random() * 200);
          console.warn(`[RESEND RETRY] Attempt ${attempt} failed with ${statusCode}. Retrying in ${backoffMs}ms...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        throw new Error(errorMsg);
      }

      if (!response.data || !response.data.id) {
        throw new Error('Resend API returned successful HTTP response but response was missing message ID');
      }

      const messageId = response.data.id;

      // Cache fingerprint for idempotency
      idempotencyCache.set(fingerprint, {
        id: messageId,
        timestamp: Date.now(),
      });

      console.log(`[RESEND ACCEPTED] Message accepted by Resend gateway. ID: ${messageId} | Recipient(s): [${toList.map(maskEmailForLogs).join(', ')}] | Subject: "${subject}"`);

      return {
        ok: true,
        status: 'ACCEPTED',
        id: messageId,
        messageId,
        provider: 'resend',
        deliveryState: 'QUEUED_BY_GATEWAY',
        to: toList,
        cc: ccList,
        bcc: bccList,
      };
    } catch (err) {
      if (attempt <= maxRetries && (/rate limit|timeout|network|5\d{2}/i.test(err.message))) {
        const backoffMs = attempt * 1000;
        console.warn(`[RESEND RETRY] Attempt ${attempt} failed: ${err.message}. Retrying in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
}
