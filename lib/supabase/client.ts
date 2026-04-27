import { createBrowserClient } from '@supabase/ssr';

function createPrerenderSafeClient() {
  const chain: any = new Proxy(function noop() {}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'auth') {
        return {
          getUser: async () => ({ data: { user: null }, error: null }),
          signInWithPassword: async () => ({ data: null, error: new Error('Supabase client is unavailable during prerender') }),
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

function requiredPublicEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Add it in Vercel Project Settings > Environment Variables.`);
  }
  return value;
}

export function createClient() {
  // Client components are pre-rendered on the server during `next build`.
  if (typeof window === 'undefined') return createPrerenderSafeClient();

  return createBrowserClient(
    requiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}
