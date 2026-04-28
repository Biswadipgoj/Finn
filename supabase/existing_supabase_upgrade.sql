-- ============================================================
-- EXISTING SUPABASE UPGRADE
-- Use this on your current Supabase database with old tables/data.
-- It is designed to be idempotent and non-destructive: it adds missing columns,
-- relaxes/updates constraints, replaces functions/triggers, and keeps existing data.
-- ============================================================
-- ============================================================
-- TELEPOINT / FINN EMI PORTAL — Supabase SQL v3
-- Safe/idempotent. Uses Asia/Kolkata business-date logic.
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- Core tables ----------
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'retailer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retailers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  retail_pin TEXT,
  mobile TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id UUID NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  father_name TEXT,
  aadhaar TEXT,
  voter_id TEXT,
  address TEXT,
  landmark TEXT,
  mobile TEXT NOT NULL,
  alternate_number_1 TEXT,
  alternate_number_2 TEXT,
  model_no TEXT,
  imei TEXT UNIQUE NOT NULL,
  purchase_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  down_payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  disburse_amount NUMERIC(12,2),
  purchase_date DATE NOT NULL,
  emi_start_date DATE,
  emi_due_day INT NOT NULL DEFAULT 5 CHECK (emi_due_day BETWEEN 1 AND 28),
  emi_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  emi_tenure INT NOT NULL DEFAULT 6 CHECK (emi_tenure BETWEEN 1 AND 24),
  first_emi_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  first_emi_charge_paid_at TIMESTAMPTZ,
  box_no TEXT,
  customer_photo_url TEXT,
  aadhaar_front_url TEXT,
  aadhaar_back_url TEXT,
  bill_photo_url TEXT,
  emi_card_photo_url TEXT,
  photo_url TEXT,
  bill_url TEXT,
  card_url TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  lock_provider TEXT,
  lock_device_id TEXT,
  google_drive_docs TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  completion_remark TEXT,
  completion_date DATE,
  settlement_amount NUMERIC(12,2),
  settlement_date DATE,
  settled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emi_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  emi_no INT NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  paid_at TIMESTAMPTZ,
  mode TEXT,
  utr TEXT,
  approved_by UUID REFERENCES auth.users(id),
  fine_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_waived BOOLEAN NOT NULL DEFAULT FALSE,
  fine_last_calculated_at TIMESTAMPTZ,
  partial_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  partial_paid_at TIMESTAMPTZ,
  fine_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_paid_at TIMESTAMPTZ,
  collected_by_role TEXT,
  collected_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, emi_no)
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  retailer_id UUID NOT NULL REFERENCES retailers(id),
  submitted_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  mode TEXT NOT NULL,
  utr TEXT,
  scheduled_emi_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_emi_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  first_emi_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  receipt_url TEXT,
  notes TEXT,
  selected_emi_nos INT[],
  fine_for_emi_no INT,
  fine_due_date DATE,
  collected_by_role TEXT,
  collected_by_user_id UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_request_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  emi_schedule_id UUID NOT NULL REFERENCES emi_schedule(id),
  emi_no INT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(payment_request_id, emi_schedule_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES auth.users(id),
  actor_role TEXT,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  before_data JSONB,
  after_data JSONB,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fine_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_fine_amount NUMERIC(12,2) NOT NULL DEFAULT 450,
  weekly_fine_increment NUMERIC(12,2) NOT NULL DEFAULT 25,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
INSERT INTO fine_settings (id, default_fine_amount, weekly_fine_increment)
VALUES (1, 450, 25)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS fine_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  emi_schedule_id UUID REFERENCES emi_schedule(id) ON DELETE CASCADE,
  emi_no INT,
  fine_type TEXT NOT NULL CHECK (fine_type IN ('BASE','WEEKLY','PAID','WAIVED','ADJUST')),
  fine_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  cumulative_fine NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broadcast_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message TEXT NOT NULL,
  image_url TEXT,
  target_retailer_id UUID REFERENCES retailers(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL DEFAULT 'TELEPOINT',
  sender_role TEXT NOT NULL DEFAULT 'admin',
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_app_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Existing DB upgrades / constraints ----------
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS retail_pin TEXT;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emi_start_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emi_card_photo_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lock_provider TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lock_device_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_drive_docs TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settled_by UUID REFERENCES auth.users(id);
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS partial_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS partial_paid_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_last_calculated_at TIMESTAMPTZ;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS scheduled_emi_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS selected_emi_nos INT[];
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_for_emi_no INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_due_date DATE;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_role TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES auth.users(id);
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT 'TELEPOINT';
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE fine_settings ADD COLUMN IF NOT EXISTS weekly_fine_increment NUMERIC(12,2) NOT NULL DEFAULT 25;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check CHECK (status IN ('RUNNING','COMPLETE','SETTLED','NPA'));
ALTER TABLE emi_schedule DROP CONSTRAINT IF EXISTS emi_schedule_status_check;
ALTER TABLE emi_schedule ADD CONSTRAINT emi_schedule_status_check CHECK (status IN ('UNPAID','PENDING_APPROVAL','PARTIALLY_PAID','APPROVED'));
ALTER TABLE emi_schedule DROP CONSTRAINT IF EXISTS emi_schedule_mode_check;
ALTER TABLE emi_schedule ADD CONSTRAINT emi_schedule_mode_check CHECK (mode IS NULL OR mode IN ('CASH','UPI'));
ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_status_check CHECK (status IN ('PENDING','PENDING_APPROVAL','APPROVED','REJECTED'));
ALTER TABLE payment_requests ALTER COLUMN status SET DEFAULT 'PENDING_APPROVAL';
ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_mode_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_mode_check CHECK (mode IN ('CASH','UPI'));

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_customers_retailer_id ON customers(retailer_id);
CREATE INDEX IF NOT EXISTS idx_customers_imei ON customers(imei);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_emi_customer_status ON emi_schedule(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_emi_due_date ON emi_schedule(due_date);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_retailer ON payment_requests(retailer_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_customer ON payment_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_approved_at ON payment_requests(approved_at);
CREATE INDEX IF NOT EXISTS idx_payment_items_request ON payment_request_items(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_customer_tokens_token ON customer_app_tokens(token);
CREATE INDEX IF NOT EXISTS idx_broadcast_target ON broadcast_messages(target_retailer_id, expires_at);

-- ---------- Helpers ----------
CREATE OR REPLACE FUNCTION finn_ist_now()
RETURNS TIMESTAMPTZ AS $$ SELECT now(); $$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION finn_ist_date()
RETURNS DATE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date; $$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$ SELECT role FROM profiles WHERE user_id = auth.uid(); $$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_retailer_id()
RETURNS UUID AS $$ SELECT id FROM retailers WHERE auth_user_id = auth.uid(); $$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = finn_ist_now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_retailers ON retailers;
CREATE TRIGGER trg_touch_retailers BEFORE UPDATE ON retailers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_customers ON customers;
CREATE TRIGGER trg_touch_customers BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_emi_schedule ON emi_schedule;
CREATE TRIGGER trg_touch_emi_schedule BEFORE UPDATE ON emi_schedule FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_payment_requests ON payment_requests;
CREATE TRIGGER trg_touch_payment_requests BEFORE UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_customer_app_tokens ON customer_app_tokens;
CREATE TRIGGER trg_touch_customer_app_tokens BEFORE UPDATE ON customer_app_tokens FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION calculate_emi_fine_v3(
  p_due_date DATE,
  p_is_last_emi BOOLEAN,
  p_base NUMERIC DEFAULT 450,
  p_weekly NUMERIC DEFAULT 25
)
RETURNS NUMERIC AS $$
DECLARE
  v_days INT;
BEGIN
  v_days := finn_ist_date() - p_due_date;
  IF v_days <= 0 THEN RETURN 0; END IF;
  IF p_is_last_emi THEN
    RETURN CEIL(v_days::NUMERIC / 30) * p_base;
  END IF;
  IF v_days <= 30 THEN RETURN p_base; END IF;
  RETURN p_base + (FLOOR((v_days - 30)::NUMERIC / 7) * p_weekly);
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------- EMI schedule generation ----------
CREATE OR REPLACE FUNCTION generate_emi_schedule(p_customer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_customer RECORD;
  v_start_month DATE;
  v_due_date DATE;
  i INT;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM emi_schedule WHERE customer_id = p_customer_id AND status = 'UNPAID' AND COALESCE(partial_paid_amount,0) = 0;

  v_start_month := COALESCE(date_trunc('month', v_customer.emi_start_date)::date, date_trunc('month', v_customer.purchase_date + interval '1 month')::date);

  FOR i IN 1..v_customer.emi_tenure LOOP
    v_due_date := (v_start_month + ((i - 1) || ' months')::interval)::date + (v_customer.emi_due_day - 1);
    IF NOT EXISTS (SELECT 1 FROM emi_schedule WHERE customer_id = p_customer_id AND emi_no = i) THEN
      INSERT INTO emi_schedule (customer_id, emi_no, due_date, amount)
      VALUES (p_customer_id, i, v_due_date, v_customer.emi_amount);
    ELSE
      UPDATE emi_schedule
      SET due_date = v_due_date,
          amount = v_customer.emi_amount
      WHERE customer_id = p_customer_id
        AND emi_no = i
        AND status = 'UNPAID'
        AND COALESCE(partial_paid_amount,0) = 0;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trigger_generate_emi_schedule()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM generate_emi_schedule(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_customer_insert ON customers;
CREATE TRIGGER after_customer_insert AFTER INSERT ON customers FOR EACH ROW EXECUTE FUNCTION trigger_generate_emi_schedule();

CREATE OR REPLACE FUNCTION trigger_regenerate_emi_on_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.emi_tenure IS DISTINCT FROM NEW.emi_tenure
     OR OLD.emi_amount IS DISTINCT FROM NEW.emi_amount
     OR OLD.purchase_date IS DISTINCT FROM NEW.purchase_date
     OR OLD.emi_start_date IS DISTINCT FROM NEW.emi_start_date
     OR OLD.emi_due_day IS DISTINCT FROM NEW.emi_due_day THEN
    PERFORM generate_emi_schedule(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_customer_update ON customers;
CREATE TRIGGER after_customer_update AFTER UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION trigger_regenerate_emi_on_update();

-- ---------- Due breakdown ----------
CREATE OR REPLACE FUNCTION get_due_breakdown(p_customer_id UUID, p_selected_emi_no INT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
  v_next_emi RECORD;
  v_selected_emi RECORD;
  v_base NUMERIC := 450;
  v_weekly NUMERIC := 25;
  v_max_emi INT := 0;
  v_fine_due NUMERIC := 0;
  v_first_emi_charge_due NUMERIC := 0;
  v_emi_amount NUMERIC := 0;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Customer not found'); END IF;
  SELECT COALESCE(default_fine_amount,450), COALESCE(weekly_fine_increment,25) INTO v_base, v_weekly FROM fine_settings WHERE id = 1;
  SELECT COALESCE(MAX(emi_no),0) INTO v_max_emi FROM emi_schedule WHERE customer_id = p_customer_id;

  SELECT * INTO v_next_emi FROM emi_schedule
  WHERE customer_id = p_customer_id AND status IN ('UNPAID','PARTIALLY_PAID','PENDING_APPROVAL')
  ORDER BY emi_no ASC LIMIT 1;

  IF p_selected_emi_no IS NOT NULL THEN
    SELECT * INTO v_selected_emi FROM emi_schedule WHERE customer_id = p_customer_id AND emi_no = p_selected_emi_no;
  ELSE
    SELECT * INTO v_selected_emi FROM emi_schedule
    WHERE customer_id = p_customer_id AND status IN ('UNPAID','PARTIALLY_PAID','PENDING_APPROVAL')
    ORDER BY emi_no ASC LIMIT 1;
  END IF;

  IF v_selected_emi.id IS NOT NULL THEN
    v_emi_amount := GREATEST(0, COALESCE(v_selected_emi.amount,0) - COALESCE(v_selected_emi.partial_paid_amount,0));
  END IF;

  SELECT COALESCE(SUM(GREATEST(0,
    GREATEST(COALESCE(es.fine_amount,0), calculate_emi_fine_v3(es.due_date, es.emi_no = v_max_emi, v_base, v_weekly))
    - COALESCE(es.fine_paid_amount,0)
  )),0)
  INTO v_fine_due
  FROM emi_schedule es
  WHERE es.customer_id = p_customer_id
    AND es.fine_waived = FALSE
    AND (
      es.status IN ('UNPAID','PARTIALLY_PAID','PENDING_APPROVAL')
      OR COALESCE(es.fine_paid_amount,0) < COALESCE(es.fine_amount,0)
      OR es.due_date < finn_ist_date()
    );

  IF COALESCE(v_customer.first_emi_charge_amount,0) > 0 AND v_customer.first_emi_charge_paid_at IS NULL THEN
    v_first_emi_charge_due := v_customer.first_emi_charge_amount;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'customer_status', v_customer.status,
    'next_emi_no', v_next_emi.emi_no,
    'next_emi_amount', v_next_emi.amount,
    'next_emi_due_date', v_next_emi.due_date,
    'next_emi_status', v_next_emi.status,
    'selected_emi_no', COALESCE(p_selected_emi_no, v_next_emi.emi_no),
    'selected_emi_amount', v_emi_amount,
    'fine_due', v_fine_due,
    'first_emi_charge_due', v_first_emi_charge_due,
    'total_payable', v_emi_amount + v_fine_due + v_first_emi_charge_due,
    'popup_first_emi_charge', v_first_emi_charge_due > 0,
    'popup_fine_due', v_fine_due > 0,
    'is_overdue', (v_next_emi.id IS NOT NULL AND v_next_emi.due_date < finn_ist_date())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------- Payment effect helpers ----------
CREATE OR REPLACE FUNCTION recompute_customer_status_v3(p_customer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_customer RECORD;
  v_open_count INT;
  v_fine_due NUMERIC;
  v_first_charge_due BOOLEAN;
  v_max_emi INT;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_customer.status IN ('SETTLED','NPA') THEN RETURN; END IF;
  SELECT COALESCE(MAX(emi_no),0) INTO v_max_emi FROM emi_schedule WHERE customer_id = p_customer_id;
  SELECT COUNT(*) INTO v_open_count FROM emi_schedule WHERE customer_id = p_customer_id AND status IN ('UNPAID','PENDING_APPROVAL','PARTIALLY_PAID');
  SELECT COALESCE(SUM(GREATEST(0, GREATEST(COALESCE(fine_amount,0), calculate_emi_fine_v3(due_date, emi_no = v_max_emi)) - COALESCE(fine_paid_amount,0))),0)
    INTO v_fine_due FROM emi_schedule WHERE customer_id = p_customer_id AND fine_waived = FALSE;
  v_first_charge_due := COALESCE(v_customer.first_emi_charge_amount,0) > 0 AND v_customer.first_emi_charge_paid_at IS NULL;
  IF v_open_count = 0 AND v_fine_due <= 0 AND NOT v_first_charge_due THEN
    UPDATE customers SET status = 'COMPLETE', completion_date = finn_ist_date() WHERE id = p_customer_id AND status = 'RUNNING';
  ELSIF v_customer.status = 'COMPLETE' THEN
    UPDATE customers SET status = 'RUNNING', completion_date = NULL WHERE id = p_customer_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION apply_payment_request_effects_v3(p_request_id UUID, p_actor_id UUID, p_paid_at TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
  v_item RECORD;
  v_emi RECORD;
  v_paid_at TIMESTAMPTZ := COALESCE(p_paid_at, finn_ist_now());
  v_next_partial NUMERIC;
  v_next_status TEXT;
  v_fine_left NUMERIC;
  v_target RECORD;
  v_apply NUMERIC;
  v_effective_fine NUMERIC;
  v_remaining_fine NUMERIC;
  v_max_emi INT;
BEGIN
  SELECT * INTO v_req FROM payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;

  FOR v_item IN SELECT * FROM payment_request_items WHERE payment_request_id = p_request_id ORDER BY emi_no LOOP
    SELECT * INTO v_emi FROM emi_schedule WHERE id = v_item.emi_schedule_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_emi.status = 'APPROVED' AND COALESCE(v_item.amount,0) > 0 THEN
      RAISE EXCEPTION 'EMI % is already approved', v_emi.emi_no;
    END IF;
    v_next_partial := LEAST(COALESCE(v_emi.amount,0), GREATEST(0, COALESCE(v_emi.partial_paid_amount,0) + COALESCE(v_item.amount,0)));
    IF v_next_partial >= COALESCE(v_emi.amount,0) AND COALESCE(v_emi.amount,0) > 0 THEN
      v_next_status := 'APPROVED';
    ELSIF v_next_partial > 0 THEN
      v_next_status := 'PARTIALLY_PAID';
    ELSE
      v_next_status := 'UNPAID';
    END IF;

    UPDATE emi_schedule SET
      partial_paid_amount = v_next_partial,
      partial_paid_at = CASE WHEN v_next_partial > 0 THEN COALESCE(partial_paid_at, v_paid_at) ELSE NULL END,
      status = v_next_status,
      paid_at = CASE WHEN v_next_status = 'APPROVED' THEN v_paid_at ELSE NULL END,
      mode = v_req.mode,
      utr = v_req.utr,
      approved_by = p_actor_id,
      collected_by_role = COALESCE(v_req.collected_by_role, 'retailer'),
      collected_by_user_id = COALESCE(v_req.collected_by_user_id, v_req.submitted_by)
    WHERE id = v_emi.id;
  END LOOP;

  v_fine_left := COALESCE(v_req.fine_amount,0);
  IF v_fine_left > 0 THEN
    SELECT COALESCE(MAX(emi_no),0) INTO v_max_emi FROM emi_schedule WHERE customer_id = v_req.customer_id;
    FOR v_target IN
      SELECT * FROM emi_schedule
      WHERE customer_id = v_req.customer_id
      ORDER BY CASE WHEN emi_no = v_req.fine_for_emi_no THEN 0 ELSE 1 END, emi_no
      FOR UPDATE
    LOOP
      v_effective_fine := GREATEST(COALESCE(v_target.fine_amount,0), calculate_emi_fine_v3(v_target.due_date, v_target.emi_no = v_max_emi));
      v_remaining_fine := GREATEST(0, v_effective_fine - COALESCE(v_target.fine_paid_amount,0));
      IF v_remaining_fine <= 0 THEN CONTINUE; END IF;
      v_apply := LEAST(v_remaining_fine, v_fine_left);
      UPDATE emi_schedule SET
        fine_amount = v_effective_fine,
        fine_paid_amount = COALESCE(fine_paid_amount,0) + v_apply,
        fine_paid_at = v_paid_at
      WHERE id = v_target.id;
      v_fine_left := v_fine_left - v_apply;
      EXIT WHEN v_fine_left <= 0;
    END LOOP;

    IF v_fine_left > 0 THEN
      UPDATE emi_schedule SET fine_paid_amount = COALESCE(fine_paid_amount,0) + v_fine_left, fine_paid_at = v_paid_at
      WHERE id = (
        SELECT id FROM emi_schedule WHERE customer_id = v_req.customer_id
        ORDER BY CASE WHEN emi_no = v_req.fine_for_emi_no THEN 0 ELSE 1 END, emi_no LIMIT 1
      );
    END IF;

    INSERT INTO fine_history (customer_id, emi_no, fine_type, fine_amount, cumulative_fine, fine_date, reason)
    VALUES (v_req.customer_id, v_req.fine_for_emi_no, 'PAID', v_req.fine_amount, v_req.fine_amount, finn_ist_date(), 'Payment request ' || v_req.id || ' approved');
  END IF;

  IF COALESCE(v_req.first_emi_charge_amount,0) > 0 THEN
    UPDATE customers SET first_emi_charge_paid_at = COALESCE(first_emi_charge_paid_at, v_paid_at) WHERE id = v_req.customer_id;
  END IF;

  PERFORM recompute_customer_status_v3(v_req.customer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reverse_payment_request_effects_v3(p_request_id UUID)
RETURNS VOID AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
  v_item RECORD;
  v_emi RECORD;
  v_next_partial NUMERIC;
  v_next_status TEXT;
  v_fine_left NUMERIC;
  v_target RECORD;
  v_take NUMERIC;
BEGIN
  SELECT * INTO v_req FROM payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  FOR v_item IN SELECT * FROM payment_request_items WHERE payment_request_id = p_request_id ORDER BY emi_no DESC LOOP
    SELECT * INTO v_emi FROM emi_schedule WHERE id = v_item.emi_schedule_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_next_partial := GREATEST(0, COALESCE(v_emi.partial_paid_amount,0) - COALESCE(v_item.amount,0));
    IF v_next_partial >= COALESCE(v_emi.amount,0) AND COALESCE(v_emi.amount,0) > 0 THEN
      v_next_status := 'APPROVED';
    ELSIF v_next_partial > 0 THEN
      v_next_status := 'PARTIALLY_PAID';
    ELSE
      v_next_status := 'UNPAID';
    END IF;
    UPDATE emi_schedule SET
      partial_paid_amount = v_next_partial,
      partial_paid_at = CASE WHEN v_next_partial > 0 THEN partial_paid_at ELSE NULL END,
      status = v_next_status,
      paid_at = CASE WHEN v_next_status = 'APPROVED' THEN paid_at ELSE NULL END,
      mode = CASE WHEN v_next_partial > 0 THEN mode ELSE NULL END,
      utr = CASE WHEN v_next_partial > 0 THEN utr ELSE NULL END,
      approved_by = CASE WHEN v_next_partial > 0 THEN approved_by ELSE NULL END,
      collected_by_role = CASE WHEN v_next_partial > 0 THEN collected_by_role ELSE NULL END,
      collected_by_user_id = CASE WHEN v_next_partial > 0 THEN collected_by_user_id ELSE NULL END
    WHERE id = v_emi.id;
  END LOOP;

  v_fine_left := COALESCE(v_req.fine_amount,0);
  IF v_fine_left > 0 THEN
    FOR v_target IN
      SELECT * FROM emi_schedule
      WHERE customer_id = v_req.customer_id AND COALESCE(fine_paid_amount,0) > 0
      ORDER BY CASE WHEN emi_no = v_req.fine_for_emi_no THEN 0 ELSE 1 END, emi_no
      FOR UPDATE
    LOOP
      v_take := LEAST(COALESCE(v_target.fine_paid_amount,0), v_fine_left);
      UPDATE emi_schedule SET
        fine_paid_amount = GREATEST(0, COALESCE(fine_paid_amount,0) - v_take),
        fine_paid_at = CASE WHEN GREATEST(0, COALESCE(fine_paid_amount,0) - v_take) > 0 THEN fine_paid_at ELSE NULL END
      WHERE id = v_target.id;
      v_fine_left := v_fine_left - v_take;
      EXIT WHEN v_fine_left <= 0;
    END LOOP;
  END IF;

  IF COALESCE(v_req.first_emi_charge_amount,0) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM payment_requests
      WHERE customer_id = v_req.customer_id AND id <> v_req.id AND status = 'APPROVED' AND COALESCE(first_emi_charge_amount,0) > 0
    ) THEN
      UPDATE customers SET first_emi_charge_paid_at = NULL WHERE id = v_req.customer_id;
    END IF;
  END IF;

  PERFORM recompute_customer_status_v3(v_req.customer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION approve_payment_request_v3(p_request_id UUID, p_admin_id UUID, p_remark TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
  v_now TIMESTAMPTZ := finn_ist_now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_admin_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Super admin required');
  END IF;

  SELECT * INTO v_req FROM payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  IF v_req.status = 'APPROVED' THEN RETURN jsonb_build_object('success', true, 'already_approved', true, 'request_id', p_request_id, 'approved_at', v_req.approved_at); END IF;
  IF v_req.status NOT IN ('PENDING','PENDING_APPROVAL') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot approve status ' || v_req.status);
  END IF;

  UPDATE payment_requests SET
    status = 'APPROVED',
    approved_by = p_admin_id,
    approved_at = v_now,
    rejected_by = NULL,
    rejected_at = NULL,
    rejection_reason = NULL,
    notes = CASE WHEN p_remark IS NOT NULL AND length(trim(p_remark)) > 0 THEN COALESCE(notes || E'\n', '') || 'Admin remark: ' || p_remark ELSE notes END
  WHERE id = p_request_id;

  PERFORM apply_payment_request_effects_v3(p_request_id, p_admin_id, v_now);

  INSERT INTO audit_log (actor_user_id, actor_role, action, table_name, record_id, before_data, after_data, remark)
  VALUES (p_admin_id, 'super_admin', 'APPROVE_PAYMENT', 'payment_requests', p_request_id,
    jsonb_build_object('status', v_req.status), jsonb_build_object('status', 'APPROVED', 'approved_at', v_now), p_remark);

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'approved_at', v_now);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_payment_request_v3(p_request_id UUID, p_admin_id UUID, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
  v_now TIMESTAMPTZ := finn_ist_now();
  v_item RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_admin_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Super admin required');
  END IF;
  SELECT * INTO v_req FROM payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  IF v_req.status = 'APPROVED' THEN PERFORM reverse_payment_request_effects_v3(p_request_id); END IF;

  FOR v_item IN SELECT emi_schedule_id FROM payment_request_items WHERE payment_request_id = p_request_id LOOP
    UPDATE emi_schedule SET status = CASE WHEN COALESCE(partial_paid_amount,0) > 0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END
    WHERE id = v_item.emi_schedule_id AND status = 'PENDING_APPROVAL';
  END LOOP;

  UPDATE payment_requests SET status = 'REJECTED', rejected_by = p_admin_id, rejected_at = v_now,
    rejection_reason = p_reason, approved_by = NULL, approved_at = NULL
  WHERE id = p_request_id;

  INSERT INTO audit_log (actor_user_id, actor_role, action, table_name, record_id, before_data, after_data, remark)
  VALUES (p_admin_id, 'super_admin', 'REJECT_PAYMENT', 'payment_requests', p_request_id,
    jsonb_build_object('status', v_req.status), jsonb_build_object('status', 'REJECTED', 'rejected_at', v_now), p_reason);

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'rejected_at', v_now);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION edit_payment_request_v3(p_request_id UUID, p_admin_id UUID, p_updates JSONB)
RETURNS JSONB AS $$
DECLARE
  v_before payment_requests%ROWTYPE;
  v_after payment_requests%ROWTYPE;
  v_status TEXT;
  v_paid_at TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_admin_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Super admin required');
  END IF;
  SELECT * INTO v_before FROM payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment request not found'); END IF;

  IF v_before.status = 'APPROVED' THEN PERFORM reverse_payment_request_effects_v3(p_request_id); END IF;

  v_status := COALESCE(NULLIF(p_updates->>'status',''), v_before.status);
  v_paid_at := COALESCE(NULLIF(p_updates->>'paid_at','')::timestamptz, v_before.approved_at, finn_ist_now());

  IF COALESCE(NULLIF(p_updates->>'mode',''), v_before.mode) = 'UPI' AND COALESCE(NULLIF(p_updates->>'utr',''), v_before.utr) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UTR is required for UPI payments');
  END IF;

  UPDATE payment_requests SET
    status = v_status,
    mode = COALESCE(NULLIF(p_updates->>'mode',''), mode),
    utr = NULLIF(p_updates->>'utr',''),
    total_emi_amount = COALESCE((p_updates->>'total_emi_amount')::numeric, total_emi_amount),
    fine_amount = COALESCE((p_updates->>'fine_amount')::numeric, fine_amount),
    first_emi_charge_amount = COALESCE((p_updates->>'first_emi_charge_amount')::numeric, first_emi_charge_amount),
    total_amount = COALESCE((p_updates->>'total_amount')::numeric, total_amount),
    notes = COALESCE(p_updates->>'notes', notes),
    collected_by_role = COALESCE(NULLIF(p_updates->>'collected_by_role',''), collected_by_role),
    collected_by_user_id = COALESCE(NULLIF(p_updates->>'collected_by_user_id','')::uuid, collected_by_user_id),
    fine_for_emi_no = COALESCE(NULLIF(p_updates->>'fine_for_emi_no','')::int, fine_for_emi_no),
    fine_due_date = COALESCE(NULLIF(p_updates->>'fine_due_date','')::date, fine_due_date),
    approved_by = CASE WHEN v_status = 'APPROVED' THEN p_admin_id ELSE NULL END,
    approved_at = CASE WHEN v_status = 'APPROVED' THEN v_paid_at ELSE NULL END,
    rejected_by = CASE WHEN v_status = 'REJECTED' THEN p_admin_id ELSE NULL END,
    rejected_at = CASE WHEN v_status = 'REJECTED' THEN finn_ist_now() ELSE NULL END
  WHERE id = p_request_id
  RETURNING * INTO v_after;

  IF v_status = 'APPROVED' THEN PERFORM apply_payment_request_effects_v3(p_request_id, p_admin_id, v_paid_at); END IF;
  PERFORM recompute_customer_status_v3(v_after.customer_id);

  INSERT INTO audit_log (actor_user_id, actor_role, action, table_name, record_id, before_data, after_data, remark)
  VALUES (p_admin_id, 'super_admin', 'EDIT_PAYMENT', 'payment_requests', p_request_id, to_jsonb(v_before), to_jsonb(v_after), 'Payment edited by super admin');

  RETURN jsonb_build_object('success', true, 'payment', to_jsonb(v_after));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_payment_request_v3(p_request_id UUID, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_before payment_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_admin_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Super admin required');
  END IF;
  SELECT * INTO v_before FROM payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment request not found'); END IF;
  IF v_before.status = 'APPROVED' THEN PERFORM reverse_payment_request_effects_v3(p_request_id); END IF;
  DELETE FROM payment_requests WHERE id = p_request_id;
  INSERT INTO audit_log (actor_user_id, actor_role, action, table_name, record_id, before_data, after_data, remark)
  VALUES (p_admin_id, 'super_admin', 'DELETE_PAYMENT', 'payment_requests', p_request_id, to_jsonb(v_before), jsonb_build_object('deleted', true), 'Payment deleted by super admin');
  RETURN jsonb_build_object('success', true, 'request_id', p_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill missing items from selected_emi_nos when possible.
INSERT INTO payment_request_items (payment_request_id, emi_schedule_id, emi_no, amount)
SELECT pr.id, es.id, es.emi_no, pr.total_emi_amount / GREATEST(array_length(pr.selected_emi_nos,1), 1)
FROM payment_requests pr
JOIN LATERAL unnest(pr.selected_emi_nos) AS selected(emi_no) ON TRUE
JOIN emi_schedule es ON es.customer_id = pr.customer_id AND es.emi_no = selected.emi_no
WHERE pr.selected_emi_nos IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM payment_request_items pri WHERE pri.payment_request_id = pr.id)
ON CONFLICT DO NOTHING;

-- ---------- Row Level Security ----------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE retailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_app_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self ON profiles;
DROP POLICY IF EXISTS profiles_admin_all ON profiles;
DROP POLICY IF EXISTS retailers_admin_all ON retailers;
DROP POLICY IF EXISTS retailers_self_read ON retailers;
DROP POLICY IF EXISTS customers_admin_all ON customers;
DROP POLICY IF EXISTS customers_retailer_select ON customers;
DROP POLICY IF EXISTS emi_admin_all ON emi_schedule;
DROP POLICY IF EXISTS emi_retailer_select ON emi_schedule;
DROP POLICY IF EXISTS pr_admin_all ON payment_requests;
DROP POLICY IF EXISTS pr_retailer_select ON payment_requests;
DROP POLICY IF EXISTS pri_admin_all ON payment_request_items;
DROP POLICY IF EXISTS pri_retailer_select ON payment_request_items;
DROP POLICY IF EXISTS audit_admin_select ON audit_log;
DROP POLICY IF EXISTS fine_settings_admin_all ON fine_settings;
DROP POLICY IF EXISTS fine_settings_read ON fine_settings;
DROP POLICY IF EXISTS fine_history_admin_all ON fine_history;
DROP POLICY IF EXISTS fine_history_retailer_select ON fine_history;
DROP POLICY IF EXISTS broadcast_admin_all ON broadcast_messages;
DROP POLICY IF EXISTS broadcast_retailer_select ON broadcast_messages;
DROP POLICY IF EXISTS tokens_admin_all ON customer_app_tokens;
DROP POLICY IF EXISTS tokens_retailer_all ON customer_app_tokens;

CREATE POLICY profiles_self ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY profiles_admin_all ON profiles FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY retailers_admin_all ON retailers FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY retailers_self_read ON retailers FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY customers_admin_all ON customers FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY customers_retailer_select ON customers FOR SELECT USING (get_my_role() = 'retailer' AND retailer_id = get_my_retailer_id());
CREATE POLICY emi_admin_all ON emi_schedule FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY emi_retailer_select ON emi_schedule FOR SELECT USING (get_my_role() = 'retailer' AND customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id()));
CREATE POLICY pr_admin_all ON payment_requests FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY pr_retailer_select ON payment_requests FOR SELECT USING (get_my_role() = 'retailer' AND retailer_id = get_my_retailer_id());
CREATE POLICY pri_admin_all ON payment_request_items FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY pri_retailer_select ON payment_request_items FOR SELECT USING (get_my_role() = 'retailer' AND payment_request_id IN (SELECT id FROM payment_requests WHERE retailer_id = get_my_retailer_id()));
CREATE POLICY audit_admin_select ON audit_log FOR SELECT USING (get_my_role() = 'super_admin');
CREATE POLICY fine_settings_admin_all ON fine_settings FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY fine_settings_read ON fine_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY fine_history_admin_all ON fine_history FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY fine_history_retailer_select ON fine_history FOR SELECT USING (get_my_role() = 'retailer' AND customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id()));
CREATE POLICY broadcast_admin_all ON broadcast_messages FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY broadcast_retailer_select ON broadcast_messages FOR SELECT USING (get_my_role() = 'retailer' AND target_retailer_id = get_my_retailer_id());
CREATE POLICY tokens_admin_all ON customer_app_tokens FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY tokens_retailer_all ON customer_app_tokens FOR ALL USING (get_my_role() = 'retailer' AND customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id())) WITH CHECK (get_my_role() = 'retailer' AND customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id()));

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_retailer_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_payment_request_v3(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION reject_payment_request_v3(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION edit_payment_request_v3(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION delete_payment_request_v3(UUID, UUID) TO service_role;
GRANT SELECT ON customer_app_tokens TO anon;
GRANT SELECT, INSERT, UPDATE ON customer_app_tokens TO authenticated;
GRANT ALL ON customer_app_tokens TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'Finn EMI Portal v3 SQL installed. Payment approval/edit/reject functions are atomic. Business date/time uses Asia/Kolkata.';
END $$;
