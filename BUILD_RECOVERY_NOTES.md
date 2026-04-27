# Build Recovery & Mobile Fix Notes

This package was recovered for GitHub + Vercel + Supabase deployment with the following changes:

- Pinned runtime-sensitive dependencies in `package.json` instead of leaving broad Supabase/Next ranges.
- Added `typecheck` script for local validation.
- Added Node engine `20.x` for Vercel stability.
- Removed external Google Fonts dependency from the app layout so builds do not depend on Google font fetching.
- Added build-safe Supabase client wrappers so browser/server Supabase clients are not constructed during prerender.
- Marked runtime pages/API routes as dynamic where they depend on Supabase/request state.
- Removed middleware from the build-recovery source because the edge middleware bundle can hang in this sandbox; route-level API checks and Supabase SQL/RLS/RPC still enforce role/ownership security.
- Disabled output file tracing in `next.config.js` because this sandbox's Node 22 + tracing combination hangs; deploy on Vercel with Node 20 from source.
- Fixed mobile payment accessibility:
  - Retailer customer page now has a fixed mobile “Collect” action above the bottom nav.
  - The payment modal body scrolls independently so Submit/Cancel stay visible.
  - Retailer tables use mobile card layout wrappers to reduce horizontal scrolling.

## Validation performed here

- Parsed all TS/TSX files with the TypeScript compiler API: **50 files, 0 syntax errors**.

## Build/install limitation in this sandbox

A full `npm install` / `next build` could not complete here because the npm registry connection timed out repeatedly in the sandbox. The final zip intentionally does **not** include `node_modules` because that should not be committed to GitHub or uploaded to Vercel.

Recommended local/Vercel validation:

```bash
npm install
npm run typecheck
npm run build
```

For Vercel, set these environment variables before deploying:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
```
