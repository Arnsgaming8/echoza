// Shared helpers for `conversations.is_group` reads/writes.
//
// The is_group column was declared INTEGER DEFAULT 0 in migration.sql, but the
// live DB column type may have resolved as BOOLEAN or TEXT depending on how
// Supabase auto-coerced the migration. Anywhere we read or write this column
// needs to be tolerant of INTEGER 0/1, BOOLEAN true/false, and '0'/'1' strings.

export function isGroupFlag(val: any): boolean {
  return val === 1 || val === '1' || val === true || val === 'true';
}

/**
 * Treats a conversations row as a direct-message conv iff (a) the row exists
 * and (b) its is_group flag is NOT set. Replaces inline ternaries that used
 * to also filter at the SQL layer via `.eq('is_group', 0)` — that filter
 * silently excludes every row when the column type doesn't match.
 */
export function pickDirect(row: any): any {
  return row && !isGroupFlag(row.is_group) ? row : null;
}
