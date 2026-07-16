// ─────────────────────────────────────────────────────────────────────────────
// client/src/utils/deviceId.ts
// Persistent, browser-local device identifier. Sent in the `X-Device-Id`
// request header on every /api/auth/login, /api/auth/register, and the two
// forgot-password routes so the server can recognize "same browser" across
// page reloads.
//
// Generation rules:
//   - Generated lazily on first call.
//   - Persisted in localStorage under `echoza:device-id` so it survives
//     page reloads, browser restarts, and PWA reinstalls.
//   - On localStorage access failure (Safari private mode, disabled
//     cookies), falls back to an in-memory UUID for the current page
//     session — that fallback is lost on reload, but login requests still
//     succeed.
//
// Rotation policy: a user can clear the device id by clearing browser
// data; the server doesn't enforce id immutability. If the id is missing
// when the user attempts forgot-password, they need to use one of their
// other 2 devices (or wait for the admin to reset).
//
// This id is generated client-side (not server-issued) so the id namespace
// is stable across server restarts and migrations. The server treats it as
// opaque text and only matches by string equality.
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE_ID_STORAGE_KEY = 'echoza:device-id';

// In-memory fallback used when localStorage is unavailable. The string
// is rebuilt per page-load so two reloads in disabled-storage mode
// produce different ids — acceptable, since users in this mode
// generally can't use forgot-password anyway (no persistence).
let memoryFallbackId: string | null = null;

function generateDeviceId(): string {
  // crypto.randomUUID is in all modern browsers (2022+) including iOS Safari.
  // Fallback to a Math.random-based UUID-like string for very old engines.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC-4122–ish shape. Not cryptographically strong but acceptable as a
  // persistence key since the server treats it as opaque.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceId(): string {
  // Try localStorage first.
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && existing.length > 0 && existing.length <= 256) return existing;
      const fresh = generateDeviceId();
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
      return fresh;
    }
  } catch {
    // localStorage may throw on disabled-cookies / quota-exceeded /
    // security-error Safari modes. Fall through to memory.
  }

  if (!memoryFallbackId) {
    memoryFallbackId = generateDeviceId();
  }
  return memoryFallbackId;
}

/** Build a fetch options object pre-populated with the X-Device-Id header. */
export function withDeviceHeaders(
  init: RequestInit = {},
): RequestInit {
  const headers = new Headers(init.headers || {});
  headers.set('X-Device-Id', getDeviceId());
  // Forward the browser's User-Agent so the server can record it on
  // device_fingerprints.user_agent for future "manage devices" UI.
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    headers.set('User-Agent-Forwarded', navigator.userAgent.slice(0, 512));
  }
  return { ...init, headers };
}
