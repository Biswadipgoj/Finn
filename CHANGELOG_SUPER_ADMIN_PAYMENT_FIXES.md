# Super Admin Payment / EMI Edit Fixes

## Fixed

- Deleting an approved payment from Admin → Approvals → Edit Payment now reverses the linked payment effects.
- Rejected/deleted approved payments now clear:
  - `payment_requests.approved_at`
  - linked EMI `paid_at`
  - linked EMI `mode`
  - linked EMI `utr`
  - linked EMI `approved_by`
  - linked EMI collector fields
- EMI summaries and customer payment-date history now stop showing deleted/rejected payments because the linked EMI rows are reset.
- Fine paid amount/date is reversed when a previously approved payment is rejected or deleted.
- First EMI charge paid date is cleared when the related approved payment is rejected/deleted and no other approved first-charge payment exists.

## Added

- New admin API route: `PATCH /api/admin/emi-schedule/[id]`
  - Super admin can directly edit EMI date, amount, status, payment date/time, payment mode, UTR, fine amount, fine paid amount, fine paid date/time, and fine waived status.
- New admin API route behavior: `DELETE /api/admin/payments/[id]`
  - Deletes the payment request and automatically clears linked EMI/fine/first-charge payment markers.
- Admin EMI Schedule table now has an Edit button for every EMI row, not only unpaid rows.
- Admin EMI editor saves directly to Supabase SQL through service-role API.
- Customer edit form now includes super-admin controls for:
  - customer status
  - first EMI charge paid date/time
  - completion/settlement date
  - completion remark

## Migration

No new SQL migration is required for this patch. It uses existing columns.
