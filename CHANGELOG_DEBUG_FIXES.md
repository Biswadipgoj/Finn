# Debug fixes applied

These updates were made from the uploaded NOTES checklist.

## Main fixes

- Fixed customer portal due calculation so ₹450 fine is not added automatically when only EMI is due.
- Added customer portal fine paid amounts and fine paid dates by returning `fine_paid_amount` and `fine_paid_at` from customer login.
- Fixed fine detail UI to use the correct `baseFineTotal` field from `getPerEmiFineBreakdown`.
- Fixed paid date display to include year in customer portal and EMI schedule.
- Fixed retailer fine-only payment requests so they no longer reduce/mark fine as paid before admin approval.
- Fixed admin direct fine collection so it can collect fines even when EMI principal was already paid.
- Added fallback support for approving retailer fine-only / first-EMI-charge-only requests.
- Added UTR return/display support in relevant payment/login flows.
- Reworked fine-due report output to aggregate one row per IMEI/customer with total fine due and first EMI charge due.
- Added optional `reference_name` and `reference_mobile` fields in customer form/type.
- Added migration `migrations/011_debug_fixes.sql`.

## Required after upload

Run this migration in Supabase SQL Editor:

```sql
-- open and run:
migrations/011_debug_fixes.sql
```

Then deploy/build the Next.js app normally.

## Additional fix - approval edit payment date

- Fixed Admin → Approvals → Edit Payment so changing **Paid / Approved Date** now updates `payment_requests.approved_at` even when the payment was already approved.
- Synced the edited date to linked `emi_schedule.paid_at`, fine paid date, and first EMI charge paid date where applicable.
- Prevented duplicate fine history entries when only editing the date of an already-approved payment.
