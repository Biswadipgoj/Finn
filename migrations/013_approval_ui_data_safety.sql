-- ============================================================
-- 013_approval_ui_data_safety.sql
-- Safe schema support for approval edit/delete flows and notices.
-- Run after earlier migrations. This file is idempotent.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Payment requests: columns used by admin approval/edit UI and APIs.
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_role TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES auth.users(id);
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_for_emi_no INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_due_date DATE;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collect_type TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id);
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_requests_collected_by_role_check'
  ) THEN
    ALTER TABLE payment_requests
      ADD CONSTRAINT payment_requests_collected_by_role_check
      CHECK (collected_by_role IS NULL OR collected_by_role IN ('admin', 'retailer'));
  END IF;
END $$;

-- EMI schedule: columns cleared/updated when a payment is edited, rejected, or deleted.
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS collected_by_role TEXT;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES auth.users(id);
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_last_calculated_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emi_schedule_collected_by_role_check'
  ) THEN
    ALTER TABLE emi_schedule
      ADD CONSTRAINT emi_schedule_collected_by_role_check
      CHECK (collected_by_role IS NULL OR collected_by_role IN ('admin', 'retailer'));
  END IF;
END $$;

-- Customer fields used by first EMI charge and super-admin account completion flows.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_emi_charge_paid_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS completion_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS completion_remark TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Useful indexes for approval page and payment lookup.
CREATE INDEX IF NOT EXISTS idx_payment_requests_status_created
  ON payment_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_requests_customer_status
  ON payment_requests(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_requests_utr
  ON payment_requests(utr);

CREATE INDEX IF NOT EXISTS idx_payment_request_items_request
  ON payment_request_items(payment_request_id);

CREATE INDEX IF NOT EXISTS idx_emi_schedule_customer_emi
  ON emi_schedule(customer_id, emi_no);

CREATE INDEX IF NOT EXISTS idx_emi_schedule_paid_at
  ON emi_schedule(paid_at);

-- Generic updated_at helper.
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_requests_updated_at ON payment_requests;
CREATE TRIGGER trg_payment_requests_updated_at
BEFORE UPDATE ON payment_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_emi_schedule_updated_at ON emi_schedule;
CREATE TRIGGER trg_emi_schedule_updated_at
BEFORE UPDATE ON emi_schedule
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Retailer/customer notice table, if not already created by migration 012.
CREATE TABLE IF NOT EXISTS portal_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notice_key TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL DEFAULT 'retailer'
    CHECK (audience IN ('retailer', 'super_admin', 'customer', 'all')),
  title TEXT,
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO portal_notices (notice_key, audience, title, message, is_active, sort_order)
VALUES (
  'retailer_bottom_disclaimer',
  'retailer',
  'Payment Reminder',
  'Please verify customer details before collecting payment. Submit payment requests before the due date. Late fine status is calculated automatically based on payment timing.',
  TRUE,
  1
)
ON CONFLICT (notice_key)
DO UPDATE SET
  audience = EXCLUDED.audience,
  title = EXCLUDED.title,
  message = EXCLUDED.message,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- Keep RLS enabled if the project uses it.
ALTER TABLE portal_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_notices_super_admin_all" ON portal_notices;
DROP POLICY IF EXISTS "portal_notices_authenticated_read_active" ON portal_notices;

CREATE POLICY "portal_notices_super_admin_all"
ON portal_notices
FOR ALL
USING (get_my_role() = 'super_admin')
WITH CHECK (get_my_role() = 'super_admin');

CREATE POLICY "portal_notices_authenticated_read_active"
ON portal_notices
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND is_active = TRUE
  AND (
    audience = 'all'
    OR audience = get_my_role()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON portal_notices TO authenticated;
