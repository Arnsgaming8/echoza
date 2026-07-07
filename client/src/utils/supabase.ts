import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kwoxlnoyggzhiiczlqaw.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3b3hsbm95Z2d6aGlpY3pscWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNjY5ODksImV4cCI6MjA5ODk0Mjk4OX0.E63KFC4FY2vY8fR-sEXPbjse1FJjEAKtTZir8LRXmfA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
