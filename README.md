# Finn / TelePoint EMI Portal

Vercel-ready Next.js + Supabase EMI portal.

## Deploy to Vercel

1. Upload/import this project with `package.json` at the repository root.
2. In Vercel, use:
   - Framework: `Next.js`
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: leave blank/default
   - Node.js Version: `20.x`
3. Add environment variables in Vercel Project Settings:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
```

4. In Supabase SQL Editor:
   - New DB: run `supabase/fresh_schema.sql`
   - Existing old DB: run `supabase/existing_database_upgrade.sql`
5. Redeploy after adding env vars and running SQL.

## Included v3 behavior

- Retailer payment collection creates `PENDING_APPROVAL` requests.
- Super Admin approval/rejection/edit/delete uses Supabase RPC functions for atomic DB updates.
- Retailer reports only see their own customers; Super Admin sees all.
- Monthly collection reports show remaining fine only.
- UPI shows UTR only when UPI is selected and requires it before submit.
- Mobile retailer page has reachable bottom Collect action and mobile-safe payment modal.
- IST display helpers are used for payment/date display consistency.

## Vercel fixes in this package

- `package.json` is at zip root for direct upload/import.
- Removed recovery-only Next config that can break Vercel serverless tracing.
- Removed Google Sheets backup/cron code from this version.
- Removed client-page `dynamic` exports that can confuse App Router builds.
- Added `vercel.json` with default Next.js build/install commands.
- Added `.nvmrc` and `engines.node` for Node 20.x.
