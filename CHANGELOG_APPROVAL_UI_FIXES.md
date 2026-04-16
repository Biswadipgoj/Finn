# Approval UI, Mobile Modal, and Build Safety Fixes

## Fixed runtime/client-side issues
- Removed undefined `fmt()` usage from the payment modal, EMI schedule table, and receipt page.
- Replaced unsafe amount display with the shared `formatCurrency()` helper.
- Replaced brittle payment-modal date rendering with the shared safe date formatter.

## Approval page redesign
- Rebuilt the admin payment approval page for mobile and desktop.
- Added a clear `← Dashboard` action so admin/super admin can return home from approvals.
- Fixed the Pending / All filter layout so text no longer wraps vertically on mobile.
- Added professional request cards for mobile and readable layout for desktop.
- Added inline success/error feedback inside the payment edit modal.
- Save/delete actions now show loading state, toast feedback, and inline confirmation.

## Mobile/modal fixes
- Payment modal now uses a full-height mobile panel with a sticky bottom action bar.
- Final submit/update button stays visible and clickable on mobile.
- Raised modal stacking order so bottom nav/notice cannot block modal actions.

## Font and text fixes
- Removed the old serif-style display fallback that made headings look broken.
- Added Bengali/Hindi/English font stack support.
- Fixed global wrapping rules so buttons and tabs do not split into vertical letters.
- Kept long paragraphs/notices wrapping normally.

## SQL migration
- Added `migrations/013_approval_ui_data_safety.sql` with idempotent schema support for approval edit/delete flows, indexes, updated-at triggers, and portal notice safety.
