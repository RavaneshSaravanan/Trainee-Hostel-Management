// Thin fetch wrapper for the backend. Token is kept in localStorage.
const KEY = 'hostel_token';

/**
 * Normalizes the backend API base URL from Vite environment variables.
 * In development, defaults to relative path to use Vite proxy.
 * In production, targets the configured deployed Render backend.
 */
export function getBaseUrl() {
  const raw = (import.meta.env.VITE_API_URL || '').trim();

  // In local development, use relative paths to leverage Vite's dev server proxy to localhost:5000
  if (import.meta.env.DEV) {
    if (!raw || raw.includes('localhost') || raw.includes('127.0.0.1')) {
      return '';
    }
    return raw.replace(/\/+$/, '').replace(/\/api$/, '');
  }

  // In production (e.g. Vercel deployment)
  const prodUrl = raw || 'https://trainee-hostel-management.onrender.com';
  return prodUrl.replace(/\/+$/, '').replace(/\/api$/, '');
}

export const BASE_URL = getBaseUrl();

export const getToken = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  // Pre-check offline status to avoid triggering browser network errors
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const offlineErr = new Error('You are currently offline. Please check your internet connection.');
    offlineErr.offline = true;
    offlineErr.status = 0;
    throw offlineErr;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${BASE_URL}${cleanPath}`;

  let res;
  try {
    res = await fetch(targetUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    let msg = '';
    if (isOffline) {
      msg = 'You appear to be offline. Please verify your internet connection.';
    } else {
      const isProd = import.meta.env.PROD || !!BASE_URL;
      msg = isProd
        ? 'Unable to connect to the backend server. The service may be starting up (Render free tier wakes in 30-50s) or you are offline. Please try again shortly.'
        : 'Cannot reach the local backend server on port 5000. Is "npm run dev" running in backend?';
    }
    const e = new Error(msg);
    e.offline = isOffline;
    e.cause = networkErr;
    throw e;
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    let errMessage = data.error || data.message;
    if (!errMessage) {
      if (res.status === 400) errMessage = 'Invalid request. Please check submitted data.';
      else if (res.status === 401) errMessage = 'Session expired or invalid. Please log in again.';
      else if (res.status === 403) errMessage = 'Forbidden. You do not have permission for this action.';
      else if (res.status === 404) errMessage = 'Requested resource not found.';
      else if (res.status === 502 || res.status === 503 || res.status === 504) {
        errMessage = 'Backend service is starting up or temporarily busy. Please wait a moment and retry.';
      } else if (res.status >= 500) {
        errMessage = 'Server encountered an error. Please try again later.';
      } else {
        errMessage = `Request failed with HTTP status ${res.status}`;
      }
    }
    const e = new Error(errMessage);
    e.status = res.status;
    e.data = data;
    throw e;
  }

  return data;
}
