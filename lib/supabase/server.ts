import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const FALLBACK_URL = 'http://127.0.0.1:54321';
const FALLBACK_ANON_KEY = 'public-anon-key-placeholder';
const FALLBACK_SERVICE_KEY = 'service-role-key-placeholder';

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
}

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || FALLBACK_SERVICE_KEY;
}

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    getSupabaseUrl(),
    getAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}

export function createServiceClient() {
  return createServerClient(
    getSupabaseUrl(),
    getServiceRoleKey(),
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
