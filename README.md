# Finn / TelePoint EMI Portal

Production-ready Next.js + Supabase EMI portal for **Super Admin**, **Retailer**, and **Customer** flows.

## 1) Local setup

1. Use **Node 20.x**.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create local env file from template:
   ```bash
   cp .env.example .env.local
   ```
4. Fill values in `.env.local`.
5. Start dev server:
   ```bash
   npm run dev
   ```

## 2) Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
```

> Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Never expose it in client code.

## 3) Supabase SQL instructions

Run one of these in Supabase SQL Editor:

- **Fresh project (new DB):**
  - `supabase/fresh_supabase_schema.sql`
- **Existing/old project upgrade (safe migration):**
  - `supabase/existing_supabase_upgrade.sql`

The SQL includes:
- Required tables, constraints, indexes, RLS policies.
- Role-aware data access helpers.
- Atomic payment approval/rejection/edit/delete functions.
- EMI/fine recalculation and customer status reconciliation.
- Audit logging support.

## 4) Vercel deployment

1. Push this repo to GitHub (with `package.json` at root).
2. Import to Vercel as a Next.js project.
3. Build settings:
   - Install command: `npm install`
   - Build command: `npm run build`
   - Output directory: **leave blank/default**
   - Node.js: **20.x**
4. Add all env vars in Vercel Project Settings.
5. Run SQL in Supabase first, then redeploy Vercel.

## 5) Security + workflow checklist

- Retailers can only create requests for their own customers.
- Retailer-collected payment status defaults to `PENDING_APPROVAL`.
- Retailers cannot approve requests; super admin approval queue is enforced.
- Payment approval/rejection uses SQL RPC transaction logic.
- Customer multi-loan selection now requires a short-lived login selection token (prevents customer_id-only fetch).
- Receipt endpoints are auth-scoped (admin all, retailer own receipts only).

## 6) Test/build checklist

Run before deployment:

```bash
npm install
npm run build
npm run typecheck
```

If typecheck fails because of legacy modules, fix those before release.
