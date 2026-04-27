import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

function createPrerenderSafeServerClient() {
  const chain: any = new Proxy(function noop() {}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'auth') {
        return {
          getUser: async () => ({ data: { user: null }, error: null }),
          getSession: async () => ({ data: { session: null }, error: null }),
        };
      }
      if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
      if (prop === 'throwOnError') return () => chain;
      return chain;
    },
    apply() { return chain; },
  });
  return chain;
}

function isProductionBuildPhase() {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Add it in Vercel Project Settings > Environment Variables.`);
  }
  return value;
}

export function createClient() {
  // During static analysis/prerender, Vercel may not have runtime cookies.
  if (isProductionBuildPhase()) return createPrerenderSafeServerClient();

  const cookieStore = cookies();
  return createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Ignore set-cookie attempts from Server Components.
          }
        },
      },
    }
  );
}

export function createServiceClient() {
  if (isProductionBuildPhase()) return createPrerenderSafeServerClient();

  return createSupabaseServiceClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
