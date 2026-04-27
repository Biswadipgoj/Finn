# Finn / TelePoint EMI Portal

Deployment-ready Next.js + Supabase EMI portal.

## Deploy

1. Create a Supabase project.
2. For a new database, paste and run `supabase/fresh_schema.sql` in Supabase SQL Editor.
3. For an existing old database, paste and run `supabase/existing_database_upgrade.sql` instead.
4. Create Vercel environment variables from `.env.example`.
5. Deploy this repository to Vercel.

## Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## v3 payment behavior

- Retailer payment collection creates a `PENDING_APPROVAL` request.
- Super admin approval/rejection uses Supabase RPC functions for atomic DB updates.
- Super admin payment edits/deletes reverse and reapply payment effects atomically.
- UPI requires UTR before payment submission.
- EMI/fine timestamps are displayed in Asia/Kolkata.
- Monthly collection reports scope data by role: retailers see only their own customers; super admins see all.
