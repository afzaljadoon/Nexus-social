import { createClient } from '@supabase/supabase-js';

// Read configuration from our .env.local file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 1. Safety Check: Verify that the developer added the credentials
if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'your_supabase_project_url_here') {
  console.warn(
    '⚠️ Supabase credentials are not configured in your .env.local file. Please configure them to connect to your database.'
  );
}

/**
 * supabaseClient:
 * This is the central connection point to our Supabase database.
 * We initialize it using our Project URL and the Anonymous API Key.
 * We can import this instance throughout our app to perform queries, authenticate users, etc.
 */
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
