// Shared helpers for `conversations` classification.
//
// Live lesson: the `is_group` column flag is NOT trustworthy. Postgres may
// have coerced the migration's INTEGER DEFAULT 0 into BOOLEAN or TEXT, and
// the coercion of literal `0` / `false` differs from the DB DEFAULT. After
// several deploy iterations of defensive SQL/JS filters, the only
// classification that has held up is checking the row's STRUCTURE: a row
// with user2_id set to `00000000-0000-0000-0000-000000000000` (or null) is
// ALWAYS a GROUP container (created by user1_id, real members live in
// group_members). Any row where user2_id is a non-zero UUID is ALWAYS a
// DIRECT conversation.

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export function isZeroUuid(val: any): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val !== 'string') return false;
  return val.toLowerCase() === ZERO_UUID;
}

/**
 * True iff this `conversations` row represents a GROUP container.
 * Determined by row structure: user2_id is null/zero-UUID means "creator +
 * placeholder other user", real members live in `group_members`.
 */
export function isGroupRow(row: any): boolean {
  return isZeroUuid(row?.user2_id);
}

/**
 * True iff this `conversations` row MIGHT be a direct-message conversation
 * between two real users (i.e. both user1_id and user2_id are valid non-zero
 * UUIDs). Caller decides whether the current user is one of them; structural
 * test alone is enough for existing-conv checks (the SQL already filtered
 * by exact pair).
 */
export function isDirectByStructure(row: any): boolean {
  const u1 = row?.user1_id;
  const u2 = row?.user2_id;
  if (!u1 || !u2) return false;
  return !isZeroUuid(u1) && !isZeroUuid(u2);
}

/**
 * Returns the OTHER user's id for a direct conversation the given user is
 * part of. Returns null if the row is not a direct conv, or if userId isn't
 * in either column.
 */
export function otherUserId(row: any, userId: string): string | null {
  if (!isDirectByStructure(row)) return null;
  if (row.user1_id === userId) return row.user2_id;
  if (row.user2_id === userId) return row.user1_id;
  return null;
}

/**
 * Returns the row iff it's structurally a direct conv (both user IDs are
 * real). Used by existing-conv checks in direct:start/message:send/etc —
 * the SQL query already filters to the exact (user1_id, user2_id) pair.
 */
export function pickDirect(row: any): any {
  return isDirectByStructure(row) ? row : null;
}

// Diagnostic-only — kept around so the existing console.log lines still work,
// but DO NOT use to decide what to render. The structural classifier above is
// authoritative.
export function isGroupFlag(val: any): boolean {
  return val === 1 || val === '1' || val === true || val === 'true';
}
