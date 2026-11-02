// Thin fetch wrapper for the backend. Token is kept in localStorage.
const KEY = 'hostel_token';

/**
 * Normalizes the backend API base URL from Vite environment variables.
 * Automatically trims trailing slashes and ensures no duplicate `/api` suffix.
 */
export function getBaseUrl() {
  const raw = (import.meta.env.VITE_API_URL || '').trim();
  if (!raw) return '';
  let clean = raw.replace(/\/+$/, '');
  if (clean.endsWith('/api')) {
    clean = clean.slice(0, -4);
  }
  return clean;
}

export const BASE_URL = getBaseUrl();

export const getToken = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

export async function api(path, { method = 'GET', body, auth = true } = {}) {
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
    const isProd = import.meta.env.PROD || !!BASE_URL;
    const msg = isProd
      ? 'Unable to connect to the backend server. The service might be starting up (Render free tier instances spin down after inactivity and take 30-50s to wake) or you are offline. Please try again shortly.'
      : 'Cannot reach the server. Is it running? (npm run dev)';
    const e = new Error(msg);
    e.offline = true;
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
        errMessage = 'Backend service is starting up or temporarily busy. Please wait 30 seconds and retry.';
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
