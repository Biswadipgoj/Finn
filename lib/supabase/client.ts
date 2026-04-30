import { createBrowserClient } from '@supabase/ssr';

const FALLBACK_URL = 'http://127.0.0.1:54321';
const FALLBACK_ANON_KEY = 'public-anon-key-placeholder';

function resolvePublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('[supabase] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Using local placeholder values.');
    }
  }

  return { url, anonKey };
}

export function createClient() {
  const { url, anonKey } = resolvePublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
