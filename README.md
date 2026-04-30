# Finn / TelePoint EMI Portal

Production-ready Next.js 14 + Supabase EMI collection and approval portal for `super_admin`, `retailer`, and customer app/token access flows.

## Tech stack
- Next.js 14 (App Router)
- TypeScript
- Supabase (Auth, Postgres, RLS, RPC)
- Tailwind CSS
- Vercel deployment target

## 1) Environment setup
Create a `.env.local` from `.env.example` and fill values from your Supabase project:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

> Important: Never commit `.env.local` or real keys to GitHub.

## 2) Supabase SQL setup
Two SQL scripts are provided in `/supabase`:

1. `supabase/fresh_supabase_schema.sql`
   - Use this for a brand-new Supabase project.
   - Creates all required tables, constraints, indexes, functions, triggers, and RLS policies.

2. `supabase/existing_supabase_upgrade.sql`
   - Use this for upgrading an existing/older project safely.
   - Adds missing columns/functions/policies without dropping customer/payment history.

### How to run SQL
1. Open Supabase Dashboard → SQL Editor.
2. Paste only one script based on your case (fresh vs upgrade).
3. Run the script and confirm success notices.

## 3) Local run
```bash
npm install
npm run dev
```

## 4) Build validation
```bash
npm run build
```

## 5) Vercel deployment checklist
- Keep repository root at project root (this folder has `package.json` at root).
- Node.js runtime: **20.x**.
- Build command: `npm run build`.
- Output directory: keep **blank/default**.
- Add the same three env variables in Vercel Project Settings.
- `vercel.json` is not required for default deployment in this project.

## Payment workflow (v3)
- Retailer collections create `payment_requests` with `PENDING_APPROVAL`.
- Retailers cannot approve requests.
- Super admin approves/rejects through atomic DB RPC functions.
- Approval/rejection is idempotent and guarded against double-processing.
- Approval updates EMI/payment/fine/customer status consistently.

## Security model
- Roles: `super_admin`, `retailer`, `customer`.
- Retailers are scoped to only their own customers/data.
- Super admin can access global data.
- Sensitive APIs validate authenticated user + role before operations.
- Service role key is used server-side only (`lib/supabase/server.ts`).

## Mobile UX notes
- Retailer customer detail view keeps a visible mobile fixed bottom **Collect Payment** button.
- Payment modal keeps action buttons visible with scrollable body.
- UPI instantly shows required UTR field; cash does not require UTR.

## Pre-deploy test checklist
- [ ] SQL script applied successfully (`fresh_supabase_schema.sql` OR `existing_supabase_upgrade.sql`).
- [ ] Login works for super admin and retailer.
- [ ] Retailer can submit payment requests only for own customers.
- [ ] Super admin approval queue approve/reject works.
- [ ] Monthly report/export data is role-scoped correctly.
- [ ] Mobile view shows payment actions and modal buttons.
- [ ] `npm run build` passes.
