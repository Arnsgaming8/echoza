import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
}
if (!supabaseAnonKey) {
  throw new Error('Missing SUPABASE_ANON_KEY env var')
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

export const anonSupabase = createClient(supabaseUrl, supabaseAnonKey)
