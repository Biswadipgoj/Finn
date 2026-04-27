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

export function createClient() {
  if (typeof window === 'undefined') {
    return createPrerenderSafeClient('Supabase client is unavailable during prerender');
  }

  // IMPORTANT: in Next.js client bundles, env access must be static (no process.env[name]).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anon) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Configure them in Vercel Project Settings.');
    return createPrerenderSafeClient('Missing Supabase public environment variables');
  }

  return createBrowserClient(url, anon);
}
