// ─────────────────────────────────────────────────────────────────────────────
// env.ts
// Centralized env validation. Fail-fast on a missing required var at boot
// (instead of complaining at first request). Keeps Render env-var changes
// explicit and documented in one place.
// ─────────────────────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optionalString(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : undefined;
}

function intWithDefault(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Env var ${name} must be a positive integer (got: ${raw})`);
  }
  return n;
}

export const env = {
  // ── Required ────────────────────────────────────────────────────────────
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),

  // ── Required for password-auth sign-in, but only because /me/something
  //    uses it; /api/health/DbStatus endpoints don't. Listed first so the
  //    error message is the most actionable for a fresh deploy. ────────
  PORT: intWithDefault('PORT', 3001),

  // ── Token lifetimes ─────────────────────────────────────────────────────
  ACCESS_TOKEN_TTL_MS: intWithDefault('ACCESS_TOKEN_TTL_MS', 15 * 60 * 1000), // 15m
  REFRESH_TOKEN_TTL_MS: intWithDefault(
    'REFRESH_TOKEN_TTL_MS',
    365 * 24 * 60 * 60 * 1000, // 1y soft cap: users stay signed in (no auto-logout),
                              // stolen refresh tokens still expire eventually
  ),

  // ── Existing app env (passthrough) ──────────────────────────────────────
  RENDER_EXTERNAL_URL: optionalString('RENDER_EXTERNAL_URL'),
  VAPID_PUBLIC_KEY: optionalString('VAPID_PUBLIC_KEY'),
  VAPID_PRIVATE_KEY: optionalString('VAPID_PRIVATE_KEY'),
  TURN_URL: optionalString('TURN_URL'),
  TURN_USERNAME: optionalString('TURN_USERNAME'),
  TURN_CREDENTIAL: optionalString('TURN_CREDENTIAL'),
  TURN_TLS_URL: optionalString('TURN_TLS_URL'),
};

// One-shot diagnostic at boot so ops can see exactly what was loaded (sans
// secrets). Kept at the bottom so module import has fully populated `env`.
export function logEnvSanity(): void {
  const ok: string[] = [];
  const missing: string[] = [];
  const set: string[] = [];
  ok.push('DATABASE_URL', 'JWT_SECRET', 'PORT');
  for (const k of [
    'RENDER_EXTERNAL_URL',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'TURN_URL',
    'TURN_USERNAME',
    'TURN_CREDENTIAL',
    'TURN_TLS_URL',
  ] as const) {
    if (env[k]) set.push(k);
  }
  /* suppress unused-var lint warning */
  void ok;
  void missing;
  console.log('[env] required OK; optional set:', set.join(', ') || 'none');
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('[env] VAPID keys missing — push notifications will be silently dropped.');
  }
}
