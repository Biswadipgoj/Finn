import { createBrowserClient } from '@supabase/ssr';

function createPrerenderSafeClient(reason = 'Supabase client unavailable') {
  const chain: any = new Proxy(function noop() {}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'auth') {
        return {
          getUser: async () => ({ data: { user: null }, error: null }),
          signInWithPassword: async () => ({ data: null, error: new Error(reason) }),
          signOut: async () => ({ error: null }),
        };
      }
      if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
      return chain;
    },
    apply() { return chain; },
  });
  return chain;
}

function getPublicEnv(name: string) {
  const value = process.env[name];
  return value?.trim() ? value : null;
}

export function createClient() {
  // Client components are pre-rendered on the server during `next build`.
  if (typeof window === 'undefined') return createPrerenderSafeClient('Supabase client is unavailable during prerender');

  const url = getPublicEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anon = getPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  // Never crash the whole app on the login page if env vars were missed on Vercel.
  if (!url || !anon) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Configure them in Vercel Project Settings.');
    return createPrerenderSafeClient('Missing Supabase public environment variables');
  }

  return createBrowserClient(url, anon);
}
