import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cekfrmgiecswlioflmip.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNla2ZybWdpZWNzd2xpb2ZsbWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NjgxNzQsImV4cCI6MjA5OTA0NDE3NH0.7jNMQdBhmkUHqAAMq9d2F0y29E6F9H0CBU0Ui1e--DI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
